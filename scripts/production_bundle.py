"""Public content only: never publish server routing, backups, or credentials."""
import io
import json
import stat
import sys
import zipfile
from pathlib import Path
from production_deploy import BASE, IMAGE, digest, regular, validate_article

MAX_BYTES = 10 * 1024 * 1024
ZIP_NAME = 'comfylabo-production-4484.zip'
DIGEST_NAME = 'comfylabo-production-4484.sha256'


def bundle_names(collection=False):
    return ('comfylabo-production-collection.zip', 'comfylabo-production-collection.sha256') if collection else (ZIP_NAME, DIGEST_NAME)


def allowed(name, collection=False):
    if collection:
        from production_collection import allowed_file
        return name == 'manifest.json' or allowed_file(name)
    return name == 'manifest.json' or name in BASE or IMAGE.fullmatch(name)


def unpack(data, collection=False):
    if len(data) > MAX_BYTES:
        raise ValueError('Archive too large')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        names = [e.filename for e in entries]
        if (len(entries) > (1115 if collection else 14) or len(set(names)) != len(names) or
                any(not allowed(n, collection) for n in names) or sum(e.file_size for e in entries) > MAX_BYTES or
                any(not stat.S_ISREG(e.external_attr >> 16) for e in entries)):
            raise ValueError('Unexpected archive entries')
        files = {n: archive.read(n) for n in names}
    manifest = validate_article(files, collection)
    if manifest['version'] != (4 if collection else 3):
        raise ValueError('Bundle format differs from selected scope')
    return files


def package(candidate, output, collection=False):
    candidate, output = Path(candidate), Path(output)
    if candidate.is_symlink() or not candidate.is_dir():
        raise ValueError('Invalid candidate')
    raw = regular(candidate / 'manifest.json')
    manifest = json.loads(raw.decode('utf-8'))
    names = manifest.get('files', {})
    if not isinstance(names, dict) or any(not allowed(n, collection) or n == 'manifest.json' for n in names):
        raise ValueError('Unexpected files')
    # Copy an explicit allowlist, never the directory itself or SHA256SUMS/control files.
    files = {'manifest.json': raw}
    files.update({n: regular(candidate / n) for n in names})
    validate_article(files, collection)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(files):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | 0o644) << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, files[name])
    data = buffer.getvalue()
    unpack(data, collection)
    output.mkdir(mode=0o700)
    zip_name, checksum_name = bundle_names(collection)
    (output / zip_name).write_bytes(data)
    (output / checksum_name).write_text(digest(data) + '\n', encoding='ascii')
    return digest(data)


if __name__ == '__main__':
    try:
        args = sys.argv[1:]
        collection = len(args) == 3 and args[-1] == '--collection'
        candidate, output = args[:-1] if collection else args
        print(json.dumps({'sha256': package(candidate, output, collection), 'published': False}))
    except Exception:
        sys.exit('Production bundle failed; no release was published.')
