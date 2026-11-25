"""Deterministic static article ZIP; compatible with Xserver's Python 3.6."""
import hashlib
import io
import json
import re
import stat
import sys
import zipfile
from pathlib import Path

PUBLIC_FILES = ("index.html", "styles.css", "comfylabo-logo.jpg")
FILES = PUBLIC_FILES + ("SHA256SUMS", "manifest.json")
MAX_BYTES = 10 * 1024 * 1024
MAX_IMAGES = 10
IMAGE_FILE = re.compile(r"image-[a-f0-9]{64}\.(jpg|png|webp)")
POST_FILE = re.compile(r"posts/[a-z0-9]+(?:-[a-z0-9]+)*/index\.html")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def public_files(manifest):
    names = manifest.get("files", {})
    if (manifest.get("version") != 1 or not isinstance(names, dict)
            or not set(PUBLIC_FILES).issubset(names) or len(names) > len(PUBLIC_FILES) + MAX_IMAGES
            or any(name not in PUBLIC_FILES and not IMAGE_FILE.fullmatch(name) for name in names)
            or any(not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest) for digest in names.values())
            or any(IMAGE_FILE.fullmatch(name) and names[name] != name[6:70] for name in names)):
        raise ValueError("Invalid manifest")
    return list(PUBLIC_FILES) + sorted(name for name in names if name not in PUBLIC_FILES)


def published_blog_files(manifest):
    source, posts = manifest.get("source", {}), manifest.get("posts")
    if (manifest.get("version") != 2 or manifest.get("kind") != "article-list"
            or source != {"kind": "sanity-published", "projectId": "0lwnb6yi", "dataset": "production"}
            or not isinstance(posts, list) or not 1 <= len(posts) <= 100):
        raise ValueError("Blog source is outside the approved scope")
    ids, slugs = set(), set()
    for post in posts:
        identifier, revision, slug = post.get("id"), post.get("revision"), post.get("slug")
        if (not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", identifier)
                or identifier.startswith(("drafts.", "versions."))
                or not isinstance(revision, str) or not revision.strip()
                or not isinstance(slug, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug)
                or identifier in ids or slug in slugs):
            raise ValueError("Invalid blog article identity")
        ids.add(identifier)
        slugs.add(slug)
    required = set(PUBLIC_FILES) | {"posts/{}/index.html".format(slug) for slug in slugs}
    names = manifest.get("files", {})
    if (not isinstance(names, dict) or not required.issubset(names)
            or len(names) > len(required) + len(posts) * MAX_IMAGES
            or any(name not in required and not IMAGE_FILE.fullmatch(name) for name in names)
            or any(not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest) for digest in names.values())
            or any(IMAGE_FILE.fullmatch(name) and names[name] != name[6:70] for name in names)):
        raise ValueError("Invalid blog files")
    return sorted(names)


def manifest_files(manifest, blog=False):
    return published_blog_files(manifest) if blog else public_files(manifest)


def allowed_name(name, blog=False):
    return name in FILES or IMAGE_FILE.fullmatch(name) or (blog and POST_FILE.fullmatch(name))


def validate(files, post_id=None, slug=None, blog=False):
    if "manifest.json" not in files or any(not value for value in files.values()):
        raise ValueError("Unexpected or empty article files")
    manifest = json.loads(files["manifest.json"].decode("utf-8"))
    names = manifest_files(manifest, blog)
    if set(files) != set(names + ["SHA256SUMS", "manifest.json"]):
        raise ValueError("Unexpected article files")
    if not blog and post_id and (manifest.get("postId") != post_id or manifest.get("slug") != slug):
        raise ValueError("Article is outside the approved scope")
    sums = ""
    for name in names:
        digest = sha256(files[name])
        if digest != manifest["files"][name]:
            raise ValueError("Article checksum mismatch")
        sums += "{}  {}\n".format(digest, name)
    if files["SHA256SUMS"] != sums.encode("ascii"):
        raise ValueError("Invalid checksum list")
    return files


def unpack(data, post_id, slug, blog=False):
    if len(data) > MAX_BYTES:
        raise ValueError("Archive too large")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        limit = len(FILES) + (100 * (MAX_IMAGES + 1) if blog else MAX_IMAGES)
        if (len(entries) > limit or len(set(names)) != len(names)
                or not set(FILES).issubset(names)
                or any(not allowed_name(name, blog) for name in names)):
            raise ValueError("Unexpected ZIP entries")
        if sum(entry.file_size for entry in entries) > MAX_BYTES:
            raise ValueError("Expanded archive too large")
        for entry in entries:
            if not stat.S_ISREG(entry.external_attr >> 16):
                raise ValueError("ZIP must contain regular files only")
        return validate({name: archive.read(name) for name in names}, post_id, slug, blog)


def package(release, output, blog=False):
    release, output = Path(release), Path(output)
    if release.is_symlink():
        raise ValueError("Refusing symlink release")
    entries = list(release.rglob("*"))
    if any(entry.is_symlink() or not (entry.is_file() or entry.is_dir()) for entry in entries):
        raise ValueError("Refusing symlinks or special files")
    if any(entry.is_dir() and (not blog or not re.fullmatch(r"posts(?:/[a-z0-9]+(?:-[a-z0-9]+)*)?", entry.relative_to(release).as_posix())) for entry in entries):
        raise ValueError("Unexpected directories")
    names = [entry.relative_to(release).as_posix() for entry in entries if entry.is_file()]
    limit = len(FILES) + (100 * (MAX_IMAGES + 1) if blog else MAX_IMAGES)
    if len(names) > limit or any(not allowed_name(name, blog) for name in names):
        raise ValueError("Unexpected article files")
    if any((release / name).is_symlink() or not (release / name).is_file() for name in names):
        raise ValueError("Refusing symlinks")
    if sum((release / name).stat().st_size for name in names) > MAX_BYTES:
        raise ValueError("Article too large")
    files = validate({name: (release / name).read_bytes() for name in names}, blog=blog)
    if sum(map(len, files.values())) > MAX_BYTES:
        raise ValueError("Article too large")
    output.mkdir(parents=True, exist_ok=True)
    target = output / "comfylabo-preview.zip"
    with zipfile.ZipFile(str(target), "w", zipfile.ZIP_DEFLATED) as archive:
        for name in manifest_files(json.loads(files["manifest.json"].decode("utf-8")), blog) + ["SHA256SUMS", "manifest.json"]:
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | 0o644) << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, files[name])
    (output / "comfylabo-preview.sha256").write_text(sha256(target.read_bytes()) + "\n")


if __name__ == "__main__":
    args = sys.argv[1:]
    blog = bool(args and args[-1] == "--blog")
    if blog:
        args.pop()
    if len(args) != 2:
        sys.exit("Usage: python3 scripts/site_bundle.py <release> <output-directory> [--blog]")
    package(*args, blog=blog)
