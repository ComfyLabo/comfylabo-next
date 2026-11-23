"""Deterministic static article ZIP; compatible with Xserver's Python 3.6."""
import hashlib
import io
import json
import stat
import sys
import zipfile
from pathlib import Path

PUBLIC_FILES = ("index.html", "styles.css", "comfylabo-logo.jpg")
FILES = PUBLIC_FILES + ("SHA256SUMS", "manifest.json")
MAX_BYTES = 10 * 1024 * 1024


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def validate(files, post_id=None, slug=None):
    if set(files) != set(FILES) or any(not value for value in files.values()):
        raise ValueError("Unexpected or empty article files")
    manifest = json.loads(files["manifest.json"].decode("utf-8"))
    if manifest.get("version") != 1 or set(manifest.get("files", {})) != set(PUBLIC_FILES):
        raise ValueError("Invalid manifest")
    if post_id and (manifest.get("postId") != post_id or manifest.get("slug") != slug):
        raise ValueError("Article is outside the approved scope")
    sums = ""
    for name in PUBLIC_FILES:
        digest = sha256(files[name])
        if digest != manifest["files"][name]:
            raise ValueError("Article checksum mismatch")
        sums += "{}  {}\n".format(digest, name)
    if files["SHA256SUMS"] != sums.encode("ascii"):
        raise ValueError("Invalid checksum list")
    return files


def unpack(data, post_id, slug):
    if len(data) > MAX_BYTES:
        raise ValueError("Archive too large")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) != len(FILES) or {entry.filename for entry in entries} != set(FILES):
            raise ValueError("Unexpected ZIP entries")
        if sum(entry.file_size for entry in entries) > MAX_BYTES:
            raise ValueError("Expanded archive too large")
        for entry in entries:
            if not stat.S_ISREG(entry.external_attr >> 16):
                raise ValueError("ZIP must contain regular files only")
        return validate({name: archive.read(name) for name in FILES}, post_id, slug)


def package(release, output):
    release, output = Path(release), Path(output)
    if any((release / name).is_symlink() for name in FILES):
        raise ValueError("Refusing symlinks")
    files = validate({name: (release / name).read_bytes() for name in FILES})
    if sum(map(len, files.values())) > MAX_BYTES:
        raise ValueError("Article too large")
    output.mkdir(parents=True, exist_ok=True)
    target = output / "comfylabo-preview.zip"
    with zipfile.ZipFile(str(target), "w", zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | 0o644) << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, files[name])
    (output / "comfylabo-preview.sha256").write_text(sha256(target.read_bytes()) + "\n")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: python3 scripts/site_bundle.py <release> <output-directory>")
    package(*sys.argv[1:])
