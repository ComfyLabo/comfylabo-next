import io
import fcntl
import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
import zipfile
from unittest.mock import patch
from pathlib import Path
from site_bundle import FILES, PUBLIC_FILES, package, sha256, unpack, public_files, published_blog_files
from xserver_pull import apply, verify_public


class PullTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="comfylabo-pull-")
        self.base = Path(self.temp.name)
        self.root = self.base / "comfylabo-next"
        (self.root / "releases/old").mkdir(parents=True)
        (self.root / "bin").mkdir()
        (self.root / ".comfylabo-simple").write_text("comfylabo-simple-v1\n")
        shutil.copyfile(Path(__file__).with_name("xserver-release.sh"), self.root / "bin/xserver-release.sh")
        self.write_release(self.root / "releases/old", b"old article")
        (self.root / "current").symlink_to("releases/old")
        self.source = self.base / "source"
        self.source.mkdir()
        self.write_release(self.source, b"new article")
        self.output = self.base / "output"
        self.repackage()

    def tearDown(self):
        self.temp.cleanup()

    def write_release(self, directory, body, post_id="comfylabo-mvp-welcome"):
        files = dict(zip(PUBLIC_FILES, (body, b"css", b"logo")))
        manifest = {"version": 1, "postId": post_id, "slug": "comfylabo-welcome", "files": {name: sha256(value) for name, value in files.items()}}
        files["SHA256SUMS"] = "".join("{}  {}\n".format(sha256(files[name]), name) for name in PUBLIC_FILES).encode()
        files["manifest.json"] = json.dumps(manifest).encode()
        for name, value in files.items():
            (directory / name).write_bytes(value)

    def repackage(self):
        package(self.source, self.output)
        self.archive = (self.output / "comfylabo-preview.zip").read_bytes()

    def fetch(self, url):
        return (sha256(self.archive) + "\n").encode() if url.endswith(".sha256") else self.archive

    def update(self, verify=lambda files: None):
        return apply(self.root, self.fetch, verify)

    def add_image(self):
        image = b"\x89PNG\r\n\x1a\nimage fixture"
        name = "image-" + sha256(image) + ".png"
        (self.source / name).write_bytes(image)
        manifest = json.loads((self.source / "manifest.json").read_text())
        manifest["files"][name] = sha256(image)
        (self.source / "manifest.json").write_text(json.dumps(manifest))
        (self.source / "SHA256SUMS").write_text("".join(
            "{}  {}\n".format(manifest["files"][file], file) for file in public_files(manifest)))
        self.repackage()
        return name, image

    def make_blog(self, slugs=("welcome", "second")):
        shutil.rmtree(self.source)
        self.source.mkdir()
        files = {"index.html": b"article list", "styles.css": b"css", "comfylabo-logo.jpg": b"logo"}
        for slug in slugs:
            files["posts/{}/index.html".format(slug)] = ("article " + slug).encode()
        image = b"\x89PNG\r\n\x1a\nblog image"
        files["image-" + sha256(image) + ".png"] = image
        manifest = {"version": 2, "kind": "article-list",
                    "source": {"kind": "sanity-published", "projectId": "0lwnb6yi", "dataset": "production"},
                    "posts": [{"id": "post-" + slug, "revision": "rev-1", "slug": slug} for slug in slugs],
                    "files": {name: sha256(files[name]) for name in sorted(files)}}
        files["SHA256SUMS"] = "".join("{}  {}\n".format(manifest["files"][name], name) for name in sorted(manifest["files"])).encode()
        files["manifest.json"] = json.dumps(manifest).encode()
        for name, content in files.items():
            (self.source / name).parent.mkdir(parents=True, exist_ok=True)
            (self.source / name).write_bytes(content)
        package(self.source, self.output, blog=True)
        self.archive = (self.output / "comfylabo-preview.zip").read_bytes()
        return manifest, files

    def test_blog_requires_opt_in_and_manual_rollback_stays_restored(self):
        _, files = self.make_blog()
        with self.assertRaises(ValueError):
            self.update()
        self.assertFalse((self.root / ".pull-last-handled").exists())
        seen = []
        def download(url):
            name = url.removeprefix("https://next.comfylabo.com/")
            if not name or name.endswith("/"):
                name += "index.html"
            seen.append(name)
            return files[name]
        with patch("xserver_pull.download", side_effect=download):
            apply(self.root, self.fetch, verify_public, blog=True)
        self.assertIn("posts/second/index.html", seen)
        self.assertEqual((self.root / "current/posts/second/index.html").read_bytes(), b"article second")
        subprocess.run(["sh", str(self.root / "bin/xserver-release.sh"), str(self.root), "rollback"], check=True)
        self.assertEqual((self.root / "current/index.html").read_bytes(), b"old article")
        self.assertEqual(apply(self.root, self.fetch, blog=True), "No new preview release")

    def test_blog_page_failure_rolls_back_and_does_not_repeat(self):
        _, files = self.make_blog()
        def download(url):
            name = url.removeprefix("https://next.comfylabo.com/")
            if not name or name.endswith("/"):
                name += "index.html"
            return b"broken" if name == "posts/second/index.html" else files[name]
        with patch("xserver_pull.download", side_effect=download):
            with self.assertRaises(ValueError):
                apply(self.root, self.fetch, verify_public, blog=True)
        self.assertEqual((self.root / "current/index.html").read_bytes(), b"old article")
        self.assertEqual(apply(self.root, self.fetch, blog=True), "No new preview release")

    def test_blog_addition_updates_list_and_retains_previous_release(self):
        self.make_blog()
        apply(self.root, self.fetch, lambda files: None, blog=True)
        old = os.readlink(str(self.root / "current"))
        self.make_blog(("welcome", "second", "third"))
        apply(self.root, self.fetch, lambda files: None, blog=True)
        self.assertEqual(os.readlink(str(self.root / "previous")), old)
        self.assertTrue((self.root / "current/posts/third/index.html").is_file())
        self.assertFalse((self.root / "previous/posts/third/index.html").exists())

    def test_blog_rejects_sample_wrong_source_drafts_and_unlisted_pages(self):
        manifest, _ = self.make_blog()
        for change in [
            {"source": {"kind": "sample"}},
            {"source": {"kind": "sanity-published", "projectId": "other", "dataset": "production"}},
            {"posts": [{"id": "drafts.test", "revision": "1", "slug": "welcome"}]},
            {"posts": [{"id": "versions.test", "revision": "1", "slug": "welcome"}]},
            {"posts": [manifest["posts"][0], manifest["posts"][0]]},
            {"posts": [{"id": "test", "revision": "1", "slug": "../outside"}]},
            {"files": {**manifest["files"], "posts/unlisted/index.html": "a" * 64}},
        ]:
            with self.assertRaises(ValueError):
                published_blog_files({**manifest, **change})
        with self.assertRaises(ValueError):
            package(self.source, self.base / "must-not-package")
        self.assertFalse((self.base / "must-not-package").exists())

    def test_blog_archive_rejects_traversal_symlinks_and_missing_pages(self):
        _, files = self.make_blog()
        for invalid, mode in [("posts/../escape/index.html", stat.S_IFREG),
                              ("posts/welcome/index.html", stat.S_IFLNK),
                              ("posts/missing/index.html", stat.S_IFREG)]:
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, "w") as archive:
                for name, content in files.items():
                    altered = name == "posts/welcome/index.html"
                    entry = zipfile.ZipInfo(invalid if altered else name)
                    entry.external_attr = ((mode if altered else stat.S_IFREG) | 0o644) << 16
                    archive.writestr(entry, content)
            with self.assertRaises(ValueError):
                unpack(stream.getvalue(), None, None, blog=True)
        self.assertEqual((self.root / "current/index.html").read_bytes(), b"old article")

    def test_images_are_packaged_activated_and_verified_over_https(self):
        name, image = self.add_image()
        files = unpack(self.archive, "comfylabo-mvp-welcome", "comfylabo-welcome")
        self.assertEqual(files[name], image)
        seen = []
        def download(url):
            file = "index.html" if url.endswith("/") else url.rsplit("/", 1)[1]
            seen.append(file)
            return files[file]
        with patch("xserver_pull.download", side_effect=download):
            self.update(verify_public)
        self.assertIn(name, seen)
        self.assertEqual((self.root / "current" / name).read_bytes(), image)
        original = self.archive
        self.repackage()
        self.assertEqual(self.archive, original)

    def test_missing_or_corrupt_image_preserves_previous_release(self):
        name, _ = self.add_image()
        (self.source / name).write_bytes(b"corrupted")
        with self.assertRaises(ValueError):
            self.repackage()
        def bad_image(url):
            file = "index.html" if url.endswith("/") else url.rsplit("/", 1)[1]
            return b"corrupted" if file == name else (self.source / file).read_bytes()
        with patch("xserver_pull.download", side_effect=bad_image):
            with self.assertRaises(ValueError):
                self.update(verify_public)
        self.assertEqual((self.root / "current/index.html").read_bytes(), b"old article")

    def test_manifest_cannot_add_paths_or_unbounded_files(self):
        manifest = json.loads((self.source / "manifest.json").read_text())
        for name in ["../escape.png", "image-invalid.png", "image-" + "a" * 64 + ".svg"]:
            with self.assertRaises(ValueError):
                public_files({**manifest, "files": {**manifest["files"], name: "a" * 64}})
        with self.assertRaises(ValueError):
            public_files({**manifest, "files": {**manifest["files"], **{
                "image-" + str(i).zfill(64) + ".png": str(i).zfill(64) for i in range(11)}}})

    def test_success_and_manual_rollback_stays_restored(self):
        self.update()
        self.assertEqual((self.root / "current/index.html").read_bytes(), b"new article")
        self.assertEqual(os.readlink(str(self.root / "previous")), "releases/old")
        self.assertEqual(self.update(), "No new preview release")
        subprocess.run(["sh", str(self.root / "bin/xserver-release.sh"), str(self.root), "rollback"], check=True)
        self.assertEqual(self.update(), "No new preview release")
        self.assertEqual((self.root / "current/index.html").read_bytes(), b"old article")

    def test_public_failure_restores_previous_without_loop(self):
        def fail(files):
            raise ValueError("Simulated HTTPS mismatch")
        with self.assertRaises(ValueError):
            self.update(fail)
        self.assertEqual((self.root / "current/index.html").read_bytes(), b"old article")
        self.assertEqual(self.update(), "No new preview release")

    def test_corrupt_download_wrong_article_and_modified_files_never_switch(self):
        with self.assertRaises(ValueError):
            apply(self.root, lambda url: b"a" * 64 if url.endswith(".sha256") else self.archive)
        self.assertFalse((self.root / ".pull-last-handled").exists())
        self.write_release(self.source, b"other article", "another-post")
        self.repackage()
        with self.assertRaises(ValueError):
            self.update()
        (self.source / "index.html").write_bytes(b"corrupted")
        with self.assertRaises(ValueError):
            self.repackage()
        self.assertEqual(os.readlink(str(self.root / "current")), "releases/old")

    def test_determinism_and_reject_paths_and_links(self):
        original = self.archive
        self.repackage()
        self.assertEqual(self.archive, original)
        for name, mode in (("../escape", stat.S_IFREG), ("index.html", stat.S_IFLNK)):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, "w") as archive:
                for file in FILES:
                    entry = zipfile.ZipInfo(name if file == "index.html" else file)
                    entry.external_attr = ((mode if file == "index.html" else stat.S_IFREG) | 0o644) << 16
                    archive.writestr(entry, (self.source / file).read_bytes())
            with self.assertRaises(ValueError):
                unpack(stream.getvalue(), "comfylabo-mvp-welcome", "comfylabo-welcome")
        self.assertFalse((self.base / "escape").exists())

    def test_disabled_and_network_failure_preserve_current(self):
        result = subprocess.run(["python3", str(Path(__file__).with_name("xserver_pull.py")), str(self.root)], env={**os.environ, "COMFYLABO_AUTO_DEPLOY": "false"}, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        def fail(url):
            raise OSError("Simulated download failure")
        with self.assertRaises(OSError):
            apply(self.root, fail)
        self.assertEqual(os.readlink(str(self.root / "current")), "releases/old")

    def test_overlap_never_downloads_or_switches(self):
        with (self.root / ".pull.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(apply(self.root, lambda url: self.fail("must not download")), "Another preview update is running")
        self.assertEqual(os.readlink(str(self.root / "current")), "releases/old")


if __name__ == "__main__":
    unittest.main()
