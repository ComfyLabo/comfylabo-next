import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import production_deploy as deploy


class ProductionDeployTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.package, self.public, self.private = root / 'package', root / 'public', root / 'private'
        self.package.mkdir()
        self.public.mkdir()
        self.before = b'Options -Indexes\nRewriteEngine On\nRewriteCond %{REQUEST_URI} ^/4484/$\nRewriteRule ^ "/_comfy_release_abc123/public-files.review/4484/index.html" [END]\n# Other routes unchanged\n'
        self.files = {'index.html': b'<html>New article</html>', 'styles.css': b'body{}', 'comfylabo-logo.jpg': b'logo'}
        manifest = {'version': 3, 'kind': 'production-article-candidate', 'target': deploy.URL, 'postId': deploy.ARTICLE,
                    'slug': '4484', 'revision': 'published-1', 'source': {'kind': 'sanity-published', 'projectId': '0lwnb6yi', 'dataset': 'production'},
                    'files': {n: deploy.digest(b) for n, b in self.files.items()}}
        raw = json.dumps(manifest).encode()
        version = deploy.digest(raw)
        directory = deploy.NAMESPACE + '/' + version
        self.after, routes, legacy = deploy.expected_routing(self.before, self.files, directory)
        self.plan = {'version': 1, 'kind': 'production-routing-plan', 'target': deploy.URL, 'postId': deploy.ARTICLE,
                     'revision': 'published-1', 'directory': directory, 'routes': routes, 'manifestSha256': version,
                     'beforeSha256': deploy.digest(self.before), 'afterSha256': deploy.digest(self.after)}
        for n, b in dict(self.files, **{'manifest.json': raw, 'before.htaccess': self.before, 'after.htaccess': self.after,
                                      'plan.json': json.dumps(self.plan).encode()}).items():
            (self.package / n).write_bytes(b)
        self.config = self.public / '.htaccess'
        self.config.write_bytes(self.before)
        self.config.chmod(0o644)
        self.legacy = self.public / legacy.lstrip('/')
        self.legacy.parent.mkdir(parents=True)
        self.legacy.write_bytes(b'Original article')

    def activate(self, verify=lambda plan, files: None):
        return deploy.activate(self.package, self.public, self.private, verify)

    def test_activate_and_rollback_keep_original_files(self):
        def verify(plan, files):
            self.assertEqual(self.config.read_bytes(), self.after)
            for name, data in files.items():
                self.assertEqual((self.public / plan['directory'] / name).read_bytes(), data)
        self.assertTrue(self.activate(verify)['activated'])
        self.assertEqual(self.config.stat().st_mode & 0o777, 0o644)
        backup = self.private / 'backups' / self.plan['manifestSha256']
        self.assertEqual((backup / 'legacy.html').read_bytes(), b'Original article')
        self.assertEqual((backup / 'before.htaccess').stat().st_mode & 0o777, 0o600)
        self.assertTrue(deploy.rollback(self.package, self.public, self.private, lambda url: self.legacy.read_bytes())['restored'])
        self.assertEqual(self.config.read_bytes(), self.before)
        self.assertEqual(self.legacy.read_bytes(), b'Original article')
        with self.assertRaises(ValueError):
            deploy.rollback(self.package, self.public, self.private)

    def test_changed_settings_refuse_before_writing(self):
        self.config.write_bytes(b'Changed by another publisher')
        with self.assertRaises(ValueError):
            self.activate()
        self.assertFalse(self.private.exists())
        self.assertEqual(self.config.read_bytes(), b'Changed by another publisher')

    def test_corrupt_candidate_refuses_before_writing(self):
        (self.package / 'index.html').write_bytes(b'Corrupted')
        with self.assertRaises(ValueError):
            self.activate()
        self.assertFalse(self.private.exists())
        self.assertEqual(self.config.read_bytes(), self.before)

    def test_unrelated_route_changes_refused(self):
        (self.package / 'after.htaccess').write_bytes(self.after + b'Unapproved rule\n')
        with self.assertRaises(ValueError):
            self.activate()
        self.assertEqual(self.config.read_bytes(), self.before)

    def test_failed_https_check_restores_settings(self):
        def fail(plan, files):
            raise ValueError('HTTP hash mismatch')
        with self.assertRaisesRegex(ValueError, 'original settings restored'):
            self.activate(fail)
        self.assertEqual(self.config.read_bytes(), self.before)
        self.assertEqual(self.legacy.read_bytes(), b'Original article')

    def test_concurrent_change_is_not_overwritten(self):
        def concurrent(plan, files):
            self.config.write_bytes(b'Concurrent change')
            raise ValueError('HTTP failure')
        with self.assertRaisesRegex(ValueError, 'Concurrent'):
            self.activate(concurrent)
        self.assertEqual(self.config.read_bytes(), b'Concurrent change')

    def test_rollback_refuses_changed_old_article(self):
        self.activate()
        self.legacy.write_bytes(b'Changed original')
        with self.assertRaises(ValueError):
            deploy.rollback(self.package, self.public, self.private)
        self.assertEqual(self.config.read_bytes(), self.after)

    def test_symlinked_legacy_directory_refused(self):
        original = self.legacy.parent
        moved = original.with_name('saved')
        original.rename(moved)
        original.symlink_to(moved, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.activate()
        self.assertEqual(self.config.read_bytes(), self.before)

    def test_cli_without_approval_cannot_prepare(self):
        env = dict(os.environ)
        env.pop('COMFYLABO_PRODUCTION_APPROVED', None)
        result = subprocess.run([sys.executable, '-B', deploy.__file__, 'prepare', self.plan['manifestSha256']], env=env, capture_output=True)
        self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
