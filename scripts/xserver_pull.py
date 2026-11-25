"""Pull only the approved preview article. No SSH keys or API tokens required."""
import fcntl
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

from site_bundle import MAX_BYTES, manifest_files, sha256, unpack

ASSETS = "https://github.com/ComfyLabo/comfylabo-next/releases/download/comfylabo-preview/"
SITE = "https://next.comfylabo.com/"
POST_ID = "comfylabo-mvp-welcome"
SLUG = "comfylabo-welcome"


class HTTPSRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.startswith("https://"):
            raise ValueError("Refusing non-HTTPS redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url):
    request = urllib.request.Request(url, headers={"User-Agent": "ComfyLabo-preview", "Cache-Control": "no-cache"})
    with urllib.request.build_opener(HTTPSRedirect()).open(request, timeout=30) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("Download too large")
    return data


def verify_public(files):
    manifest = json.loads(files["manifest.json"].decode("utf-8"))
    for name in manifest_files(manifest, blog=manifest.get("version") == 2):
        route = name[:-10] if name.endswith("index.html") else name
        url = SITE + route
        if sha256(download(url)) != sha256(files[name]):
            raise ValueError("Public content differs from the verified release")


def apply(root, fetch=download, verify=verify_public, blog=False):
    root = Path(root)
    if root.name != "comfylabo-next" or root.is_symlink():
        raise ValueError("Invalid release root")
    if (root / ".comfylabo-simple").read_text().strip() != "comfylabo-simple-v1":
        raise ValueError("Unmanaged release root")
    # The first working release and helper must be installed manually after approval.
    if not (root / "current").is_symlink():
        raise ValueError("A known working release is required")
    helper = root / "bin/xserver-release.sh"
    state = root / ".pull-last-handled"
    with (root / ".pull.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return "Another preview update is running"
        digest = fetch(ASSETS + "comfylabo-preview.sha256").decode("ascii").strip()
        if not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError("Invalid archive checksum")
        if state.exists() and state.read_text().strip() == digest:
            return "No new preview release"
        data = fetch(ASSETS + "comfylabo-preview.zip")
        if sha256(data) != digest:
            raise ValueError("Archive checksum mismatch; keeping current release")
        files = unpack(data, POST_ID, SLUG, blog=blog)
        version = "github-" + digest
        target = root / "releases" / version
        if target.exists() or target.is_symlink():
            raise ValueError("Release already exists; inspect before retrying")
        if (root / "releases").is_symlink():
            raise ValueError("Invalid releases directory")
        with tempfile.TemporaryDirectory(prefix=".pull-", dir=str(root)) as staging:
            directory = Path(staging) / "article"
            directory.mkdir()
            # Never extract arbitrary archive paths or symlinks.
            for name, content in files.items():
                (directory / name).parent.mkdir(parents=True, exist_ok=True)
                (directory / name).write_bytes(content)
            directory.rename(str(target))
        # Remember this digest before switching: a later manual rollback stays restored.
        # Failed activation/public verification needs inspection or a new release, not a loop.
        pending = root / ".pull-last-handled.tmp"
        pending.write_text(digest + "\n")
        pending.replace(str(state))
        old = os.readlink(str(root / "current"))
        try:
            subprocess.run(["sh", str(helper), str(root), "activate", version], check=True)
            verify(files)
        except Exception:
            if os.readlink(str(root / "current")) != old:
                subprocess.run(["sh", str(helper), str(root), "rollback"], check=True)
            raise
        return "Preview updated: " + version


if __name__ == "__main__":
    if os.environ.get("COMFYLABO_AUTO_DEPLOY") != "true":
        sys.exit("Automatic preview deployment is disabled")
    if len(sys.argv) != 2 or not re.fullmatch(r"/home/[A-Za-z0-9_-]+/comfylabo-next", sys.argv[1]):
        sys.exit("Invalid dedicated release root")
    mode = os.environ.get("COMFYLABO_PREVIEW_MODE", "single")
    if mode not in ("single", "blog"):
        sys.exit("Invalid preview mode")
    try:
        print(apply(sys.argv[1], blog=mode == "blog"))
    except Exception:
        sys.exit("Preview update failed. Inspect the current/previous links and pull log before retrying.")
