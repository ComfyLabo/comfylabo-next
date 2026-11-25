import json
import unittest
from unittest.mock import patch
import production_collection as collection
import production_deploy as deploy
import production_pull as pull
import production_bundle as bundle
import production_pull_test as fixtures


class CollectionTest(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.ProductionPullTest()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.private, self.public = self.fixture.private, self.fixture.public
        self.config = self.fixture.config
        self.make_collection([('new-one', 'new-one', 'new-1')])

    def make_collection(self, posts):
        legacy = self.fixture.fixture
        files = {'index.html': b'<html>Collection</html>', 'styles.css': b'css', 'comfylabo-logo.jpg': b'logo', collection.LEGACY_FILE: b'<html>Existing article</html>'}
        items = [{'id':deploy.ARTICLE, 'slug':'4484', 'revision':'existing-1'}]
        for identifier, slug, revision in posts:
            items.append({'id':identifier, 'slug':slug, 'revision':revision, 'publicationSystem':'comfylabo-next'})
            files['posts/' + slug + '/index.html'] = ('<html>' + revision + '</html>').encode()
        manifest = {'version':4, 'kind':'production-collection', 'target':collection.TARGET,
                    'source':{'kind':'sanity-published', 'projectId':'0lwnb6yi', 'dataset':'production'},
                    'postId':deploy.ARTICLE, 'revision':'existing-1', 'posts':items,
                    'files':{n:deploy.digest(b) for n,b in files.items()}}
        files['manifest.json'] = json.dumps(manifest).encode()
        self.files, self.manifest = files, manifest
        self.fixture.archive = self.fixture.zip_files(files)

    def apply(self, verify=lambda plan, files: None):
        return pull.apply(self.private, self.public, self.fixture.fetch, verify, collection=True)

    def test_explicit_scope_required_for_collection_archive(self):
        with self.assertRaises(ValueError):
            bundle.unpack(self.fixture.archive)
        self.assertEqual(bundle.unpack(self.fixture.archive, collection=True), self.files)
        before = self.config.read_bytes()
        with self.assertRaises(ValueError):
            self.fixture.apply()
        self.assertEqual(self.config.read_bytes(), before)

    def test_single_to_collection_and_rollback_preserve_original_routes(self):
        before = self.config.read_bytes()
        def verify(plan, files):
            urls = {r['url'] for r in plan['routes']}
            self.assertIn('/4484/', urls)
            self.assertIn('/readings/', urls)
            self.assertIn('/posts/new-one/', urls)
            self.assertIn('/4484/styles.css', urls)
            self.assertIn('/readings/styles.css', urls)
            for route in plan['routes']:
                self.assertEqual((self.public / plan['directory'] / route['file']).read_bytes(), files[route['file']])
        self.assertIn('updated:', self.apply(verify))
        self.assertIn(b'# Other routes unchanged', self.config.read_bytes())
        version = pull.load_state(self.private)['current']
        with self.assertRaises(ValueError):
            pull.load_version(self.private, version)
        self.assertEqual(pull.rollback(self.private, self.public, collection=True, verify=lambda p,f:None), 'Previous production article restored')
        self.assertEqual(self.config.read_bytes(), before)
        self.assertEqual(self.apply(), 'No new production release')

    def test_addition_allowed_but_article_loss_or_slug_change_stops(self):
        self.apply()
        self.make_collection([('new-one','new-one','new-2'), ('new-two','new-two','new-1')])
        self.apply()
        before = self.config.read_bytes()
        self.make_collection([('new-one','new-one','new-3')])
        with self.assertRaises(ValueError):
            self.apply()
        self.assertEqual(self.config.read_bytes(), before)
        self.make_collection([('new-one','renamed','new-4'), ('new-two','new-two','new-1')])
        with self.assertRaises(ValueError):
            self.apply()
        self.assertEqual(self.config.read_bytes(), before)

    def test_failed_collection_switch_restores_single_article(self):
        before = self.config.read_bytes()
        def fail(plan, files):
            raise ValueError('Public verification failed')
        with self.assertRaises(ValueError):
            self.apply(fail)
        self.assertEqual(self.config.read_bytes(), before)
        self.assertEqual(self.apply(), 'No new production release')

    def test_missing_existing_article_and_unmarked_old_content_rejected(self):
        for changes in [
            {'posts':self.manifest['posts'][1:]},
            {'posts':[self.manifest['posts'][0], {**self.manifest['posts'][1], 'publicationSystem':'legacy'}]},
        ]:
            manifest = dict(self.manifest, **changes)
            files = dict(self.files, **{'manifest.json':json.dumps(manifest).encode()})
            with self.assertRaises(ValueError):
                collection.validate(files)

    def test_conflicting_reserved_namespace_stops(self):
        original = self.fixture.fixture.before + b'RewriteCond %{REQUEST_URI} ^/readings/$\nRewriteRule ^ old [END]\n'
        with self.assertRaises(ValueError):
            pull.prepared_package(self.files, original, collection=True)

    def test_collection_bundle_publishes_no_private_settings(self):
        root = self.private / 'candidate'
        root.mkdir()
        for name, data in self.files.items():
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            (root / name).write_bytes(data)
        (root / 'before.htaccess').write_bytes(b'private settings')
        output = self.private / 'collection-bundle'
        bundle.package(root, output, collection=True)
        zipped = bundle.unpack((output / bundle.bundle_names(True)[0]).read_bytes(), collection=True)
        self.assertEqual(zipped, self.files)
        self.assertNotIn('before.htaccess', zipped)


if __name__ == '__main__':
    unittest.main()
