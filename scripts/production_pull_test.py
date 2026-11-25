import io
import fcntl
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import unittest
from unittest.mock import patch
import zipfile
import production_deploy as deploy
import production_deploy_test as fixtures
import production_bundle as bundle
import production_pull as pull


class ProductionPullTest(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.ProductionDeployTest()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.activate()
        self.public, self.private = self.fixture.public, self.fixture.private
        self.config = self.public / '.htaccess'
        version = self.fixture.plan['manifestSha256']
        (self.private / 'incoming').mkdir()
        shutil.copytree(self.fixture.package, self.private / 'incoming' / version)
        self.bootstrap = patch.object(pull, 'BOOTSTRAP', version)
        self.bootstrap.start()
        self.addCleanup(self.bootstrap.stop)
        self.files = {n: (self.fixture.package / n).read_bytes() for n in ['manifest.json'] + list(self.fixture.files)}
        self.make_article('new-1', b'<html>Updated article</html>')

    def make_article(self, revision, body, image=None):
        manifest = json.loads(self.files['manifest.json'].decode())
        self.files = {n: b for n, b in self.files.items() if n in deploy.BASE}
        self.files['index.html'] = body
        if image:
            self.files['image-' + deploy.digest(image) + '.png'] = image
        manifest['revision'] = revision
        manifest['files'] = {n: deploy.digest(b) for n, b in self.files.items()}
        self.files['manifest.json'] = json.dumps(manifest).encode()
        self.archive = self.zip_files(self.files)

    def zip_files(self, files, extra=None):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, data in list(files.items()) + (extra or []):
                item = zipfile.ZipInfo(name)
                item.create_system = 3
                item.external_attr = (stat.S_IFREG | 0o644) << 16
                archive.writestr(item, data)
        return output.getvalue()

    def fetch(self, url):
        return (deploy.digest(self.archive) + '\n').encode() if url.endswith('.sha256') else self.archive

    def apply(self, verify=lambda plan, files: None):
        return pull.apply(self.private, self.public, self.fetch, verify)

    def test_two_updates_and_rollback_do_not_reapply_or_change_other_routes(self):
        original = self.config.read_bytes()
        def verify(plan, files):
            for name, data in files.items():
                self.assertEqual((self.public / plan['directory'] / name).read_bytes(), data)
        self.make_article('new-1', b'<html>Update with image</html>', b'new image')
        self.assertIn('updated:', self.apply(verify))
        first = self.config.read_bytes()
        self.assertIn(b'# Other routes unchanged', first)
        self.assertEqual(self.fixture.legacy.read_bytes(), b'Original article')
        self.assertEqual(self.apply(), 'No new production release')
        self.make_article('new-2', b'<html>Second update</html>')
        self.assertIn('updated:', self.apply(verify))
        second = self.config.read_bytes()
        self.assertNotEqual(first, second)
        self.assertNotIn(b'/4484/image-', second)
        self.assertEqual(pull.rollback(self.private, self.public, verify), 'Previous production article restored')
        self.assertEqual(self.config.read_bytes(), first)
        self.assertEqual(self.apply(), 'No new production release')
        self.assertNotEqual(first, original)

    def test_bundle_contains_only_public_files_and_is_deterministic(self):
        a, b = self.private / 'bundle-a', self.private / 'bundle-b'
        bundle.package(self.fixture.package, a)
        bundle.package(self.fixture.package, b)
        self.assertEqual((a / bundle.ZIP_NAME).read_bytes(), (b / bundle.ZIP_NAME).read_bytes())
        files = bundle.unpack((a / bundle.ZIP_NAME).read_bytes())
        self.assertEqual(set(files), deploy.BASE | {'manifest.json'})
        self.assertNotIn('before.htaccess', files)
        self.assertNotIn('plan.json', files)

    def test_corrupt_archive_keeps_current(self):
        before = self.config.read_bytes()
        def fetch(url):
            return b'0' * 64 if url.endswith('.sha256') else self.archive
        with self.assertRaises(ValueError):
            pull.apply(self.private, self.public, fetch)
        self.assertEqual(self.config.read_bytes(), before)
        self.assertFalse((self.private / 'automatic-state.json').exists())

    def test_failed_public_check_restores_and_stops_retry_loop(self):
        before = self.config.read_bytes()
        def fail(plan, files):
            raise ValueError('HTTP mismatch')
        with self.assertRaises(ValueError):
            self.apply(fail)
        self.assertEqual(self.config.read_bytes(), before)
        self.assertEqual(self.apply(), 'No new production release')
        self.assertEqual(pull.load_state(self.private)['current'], pull.BOOTSTRAP)

    def test_changed_routing_stops_before_download(self):
        self.config.write_bytes(b'Other publisher settings')
        def fetch(url):
            self.fail('Must not download after detecting a configuration change')
        with self.assertRaises(ValueError):
            pull.apply(self.private, self.public, fetch)
        self.assertEqual(self.config.read_bytes(), b'Other publisher settings')

    def test_concurrent_settings_change_is_not_overwritten(self):
        def concurrent(plan, files):
            self.config.write_bytes(b'Concurrent publisher settings')
            raise ValueError('Public check failed')
        with self.assertRaises(ValueError):
            self.apply(concurrent)
        self.assertEqual(self.config.read_bytes(), b'Concurrent publisher settings')

    def test_storage_limit_keeps_current_and_deletes_nothing(self):
        before = self.config.read_bytes()
        legacy = self.fixture.legacy.read_bytes()
        with patch.object(pull, 'STORAGE_LIMIT', 1), self.assertRaises(ValueError):
            self.apply()
        self.assertEqual(self.config.read_bytes(), before)
        self.assertEqual(self.fixture.legacy.read_bytes(), legacy)
        self.assertEqual(len(list((self.private / 'incoming').iterdir())), 1)

    def test_wrong_article_and_preview_manifests_rejected(self):
        before = self.config.read_bytes()
        for changes in [{'postId': 'another-post'}, {'version': 2}, {'slug': 'other'}, {'target': 'https://next.comfylabo.com/'}]:
            manifest = json.loads(self.files['manifest.json'].decode())
            manifest.update(changes)
            self.archive = self.zip_files(dict(self.files, **{'manifest.json': json.dumps(manifest).encode()}))
            with self.assertRaises(ValueError):
                self.apply()
            self.assertEqual(self.config.read_bytes(), before)

    def test_archive_rejects_controls_traversal_duplicates_and_symlinks(self):
        for name in ['../outside', 'before.htaccess', '.env', 'nested/index.html']:
            with self.assertRaises(ValueError):
                bundle.unpack(self.zip_files(self.files, [(name, b'Unexpected')]))
        with self.assertRaises(ValueError):
            bundle.unpack(self.zip_files(self.files, [('index.html', b'Duplicate')]))
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            for name, value in self.files.items():
                item = zipfile.ZipInfo(name)
                item.create_system = 3
                item.external_attr = ((stat.S_IFLNK if name == 'index.html' else stat.S_IFREG) | 0o644) << 16
                archive.writestr(item, value)
        with self.assertRaises(ValueError):
            bundle.unpack(data.getvalue())

    def test_recovery_verification_failure_preserves_current(self):
        self.apply()
        current = self.config.read_bytes()
        def fail(plan, files):
            raise ValueError('Recovery HTTP failed')
        with self.assertRaises(ValueError):
            pull.rollback(self.private, self.public, fail)
        self.assertEqual(self.config.read_bytes(), current)

    def test_cli_defaults_to_disabled(self):
        env = dict(os.environ)
        env.pop('COMFYLABO_PRODUCTION_AUTO_DEPLOY', None)
        env.pop('COMFYLABO_PRODUCTION_APPROVED', None)
        for args in [[], ['rollback']]:
            result = subprocess.run([sys.executable, '-B', pull.__file__] + args, env=env, capture_output=True)
            self.assertNotEqual(result.returncode, 0)

    def test_same_time_update_stops_without_fetch(self):
        with (self.private / '.automatic.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.apply(), 'Another production operation is running')

    def test_state_write_failure_restores_current(self):
        before = self.config.read_bytes()
        actual = pull.save_state
        def fail_after_switch(private, state):
            if state['current'] != pull.BOOTSTRAP:
                raise OSError('State write failed')
            actual(private, state)
        with patch.object(pull, 'save_state', side_effect=fail_after_switch), self.assertRaises(OSError):
            self.apply()
        self.assertEqual(self.config.read_bytes(), before)
        self.assertEqual(self.apply(), 'No new production release')

    def test_log_rotation_has_bounded_retention(self):
        for i in range(160):
            pull.record('x' * 1000, self.private)
        logs = [self.private / 'automatic.log', self.private / 'automatic.log.1']
        self.assertTrue(all(p.is_file() and p.stat().st_size <= 65536 for p in logs))
        self.assertTrue(all(p.stat().st_mode & 0o777 == 0o600 for p in logs))


if __name__ == '__main__':
    unittest.main()
