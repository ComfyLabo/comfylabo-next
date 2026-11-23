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
from pathlib import Path
from site_bundle import FILES, PUBLIC_FILES, package, sha256, unpack
from xserver_pull import apply


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
