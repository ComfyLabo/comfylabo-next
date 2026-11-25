"""Approved production updates; collection mode needs a separate explicit scope."""
import fcntl
from datetime import datetime
import json
import os
import re
import sys
import urllib.request
from pathlib import Path
from production_bundle import MAX_BYTES, bundle_names, unpack
from production_deploy import (PRIVATE, PUBLIC, NAMESPACE, digest, regular, real_directory,
                               expected_routing, load_package, validate_article, atomic_config, verify_public)

ASSETS = 'https://github.com/ComfyLabo/comfylabo-next/releases/download/comfylabo-production-4484/'
COLLECTION_ASSETS = 'https://github.com/ComfyLabo/comfylabo-next/releases/download/comfylabo-production-collection/'
BOOTSTRAP = 'bc9be8f7a04aa98fca7403483d4b2645c02e108d09f0ccaf4e3a0f5a9f3863c1'
STORAGE_LIMIT = 100 * 1024 * 1024


class HTTPSRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.startswith('https://'):
            raise ValueError('Non-HTTPS redirect')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'ComfyLabo-production-4484', 'Cache-Control': 'no-cache'})
    with urllib.request.build_opener(HTTPSRedirect()).open(req, timeout=30) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('Download too large')
    return data


def valid_version(version):
    return isinstance(version, str) and re.fullmatch('[a-f0-9]{64}', version)


def load_state(private):
    state_file = private / 'automatic-state.json'
    if state_file.is_symlink():
        raise ValueError('Unsafe state file')
    state = json.loads(regular(state_file).decode('utf-8')) if state_file.exists() else {
        'current': BOOTSTRAP, 'previous': None, 'handled': None}
    if (set(state) != {'current', 'previous', 'handled'} or not valid_version(state['current']) or
            any(v is not None and not valid_version(v) for v in [state['previous'], state['handled']])):
        raise ValueError('Invalid production state')
    return state


def save_state(private, state):
    atomic_config(private / 'automatic-state.json', (json.dumps(state) + '\n').encode('ascii'), 0o600, os.getgid())


def load_version(private, version, collection=False):
    result = load_package(private / 'incoming' / version, collection)
    if result[0]['manifestSha256'] != version:
        raise ValueError('Version directory and manifest differ')
    return result


def record(message, private=PRIVATE):
    private = Path(private)
    real_directory(private)
    if regular(private / '.comfylabo-production-4484').strip() != b'comfylabo-production-4484':
        raise ValueError('Unmanaged log directory')
    log, previous = private / 'automatic.log', private / 'automatic.log.1'
    for file in [log, previous]:
        if file.is_symlink() or (file.exists() and not file.is_file()):
            raise ValueError('Unsafe log file')
    line = (datetime.utcnow().isoformat() + 'Z ' + message[:1000] + '\n').encode('utf-8')
    if log.exists() and log.stat().st_size + len(line) > 65536:
        os.replace(str(log), str(previous))
    with os.fdopen(os.open(str(log), os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600), 'ab') as output:
        output.write(line)


def check_roots(private, public):
    for directory in [private, private / 'incoming', public, public / NAMESPACE]:
        real_directory(directory)
    if regular(private / '.comfylabo-production-4484').strip() != b'comfylabo-production-4484':
        raise ValueError('Unmanaged production root')


def storage_bytes(private, public):
    total = 0
    for root in [private, public / NAMESPACE]:
        for entry in root.rglob('*'):
            if entry.is_symlink() or not (entry.is_file() or entry.is_dir()):
                raise ValueError('Unexpected storage entry')
            if entry.is_file():
                total += entry.stat().st_size
    return total


def prepared_package(files, original, collection=False):
    manifest = validate_article(files, collection)
    if manifest['version'] != (4 if collection else 3):
        raise ValueError('Incoming format differs from the approved scope')
    version = digest(files['manifest.json'])
    directory = NAMESPACE + '/' + version
    names = manifest['files']
    after, routes, legacy = expected_routing(original, names, directory, manifest)
    plan = {'version': 1, 'kind': 'production-routing-plan', 'target': manifest['target'],
            'postId': manifest['postId'], 'revision': manifest['revision'], 'directory': directory,
            'routes': routes, 'manifestSha256': version, 'beforeSha256': digest(original), 'afterSha256': digest(after)}
    package = dict(files)
    package.update({'before.htaccess': original, 'after.htaccess': after,
                    'plan.json': (json.dumps(plan) + '\n').encode('ascii')})
    return version, plan, package


def install_update(private, public, state, files, verify, collection=False):
    current_plan, current_files, original, before, legacy = load_version(private, state['current'], collection)
    config = public / '.htaccess'
    if regular(config) != before:
        raise ValueError('Production settings changed; inspect before updating')
    version, plan, package = prepared_package(files, original, collection)
    if collection:
        from production_collection import preserve_articles
        previous_manifest = json.loads(regular(private / 'incoming' / state['current'] / 'manifest.json').decode('utf-8'))
        preserve_articles(previous_manifest, json.loads(files['manifest.json'].decode('utf-8')))
    if version == state['current']:
        return 'No content change'
    # Conservative reservation includes private controls + public copy; no old files are deleted.
    required = sum(len(b) for b in package.values()) + sum(len(files[r['file']]) for r in plan['routes'])
    if storage_bytes(private, public) + required + 65536 > STORAGE_LIMIT:
        raise ValueError('Production storage limit reached; keeping current release')
    incoming = private / 'incoming' / version
    target = public / plan['directory']
    if incoming.exists() or incoming.is_symlink() or target.exists() or target.is_symlink():
        raise ValueError('Version already exists; inspect before retrying')
    incoming.mkdir(mode=0o700)
    for name, data in package.items():
        (incoming / name).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        (incoming / name).write_bytes(data)
        (incoming / name).chmod(0o600)
    load_package(incoming, collection)
    target.mkdir(mode=0o755)
    for name in files:
        if name == 'manifest.json':
            continue
        (target / name).parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        (target / name).write_bytes(files[name])
        (target / name).chmod(0o644)
        if regular(target / name) != files[name]:
            raise ValueError('Public copy mismatch')
    if regular(config) != before:
        raise ValueError('Production settings changed during staging')
    info = config.stat()
    atomic_config(config, package['after.htaccess'], info.st_mode & 0o777, info.st_gid)
    try:
        verify(plan, {r['file']: files[r['file']] for r in plan['routes']})
        if regular(config) != package['after.htaccess']:
            raise ValueError('Production settings changed during verification')
        save_state(private, {'current': version, 'previous': state['current'], 'handled': state['handled']})
    except Exception:
        if regular(config) == package['after.htaccess']:
            atomic_config(config, before, info.st_mode & 0o777, info.st_gid)
        raise
    return 'Production article updated: ' + version


def apply(private=PRIVATE, public=PUBLIC, fetch=download, verify=verify_public, collection=False):
    private, public = Path(private), Path(public)
    check_roots(private, public)
    lock_file = private / '.automatic.lock'
    if lock_file.is_symlink():
        raise ValueError('Unsafe lock')
    with os.fdopen(os.open(str(lock_file), os.O_CREAT | os.O_RDWR, 0o600), 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 'Another production operation is running'
        state = load_state(private)
        plan, files, original, current, legacy = load_version(private, state['current'], collection)
        if regular(public / '.htaccess') != current:
            raise ValueError('Production settings changed; refusing overwrite')
        assets = COLLECTION_ASSETS if collection else ASSETS
        zip_name, checksum_name = bundle_names(collection)
        checksum = fetch(assets + checksum_name).decode('ascii').strip()
        if not valid_version(checksum):
            raise ValueError('Invalid archive digest')
        if checksum == state['handled']:
            return 'No new production release'
        data = fetch(assets + zip_name)
        if digest(data) != checksum:
            raise ValueError('Archive checksum mismatch')
        incoming = unpack(data, collection)
        # Do not reapply a failed version or undo a manual rollback every two minutes.
        state['handled'] = checksum
        save_state(private, state)
        return install_update(private, public, state, incoming, verify, collection)


def rollback(private=PRIVATE, public=PUBLIC, verify=verify_public, collection=False):
    private, public = Path(private), Path(public)
    check_roots(private, public)
    lock_file = private / '.automatic.lock'
    if lock_file.is_symlink():
        raise ValueError('Unsafe lock')
    with os.fdopen(os.open(str(lock_file), os.O_CREAT | os.O_RDWR, 0o600), 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = load_state(private)
        if not state['previous']:
            raise ValueError('No previous automatic release')
        current = load_version(private, state['current'], collection)[3]
        plan, files, original, previous, legacy = load_version(private, state['previous'], collection)
        config = public / '.htaccess'
        if regular(config) != current:
            raise ValueError('Production settings changed; refusing recovery')
        for name, data in files.items():
            if regular(public / plan['directory'] / name) != data:
                raise ValueError('Recovery content changed')
        info = config.stat()
        atomic_config(config, previous, info.st_mode & 0o777, info.st_gid)
        try:
            verify(plan, files)
            if regular(config) != previous:
                raise ValueError('Concurrent production change')
            save_state(private, {'current':state['previous'], 'previous':None, 'handled':state['handled']})
        except Exception:
            if regular(config) == previous:
                atomic_config(config, current, info.st_mode & 0o777, info.st_gid)
            raise
        return 'Previous production article restored'


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['rollback']:
            scope = os.environ.get('COMFYLABO_PRODUCTION_APPROVED')
            if scope not in ('obsidian-4484', 'new-articles'):
                raise ValueError('Explicit recovery approval required')
            result = rollback(collection=scope == 'new-articles')
        elif not sys.argv[1:] and os.environ.get('COMFYLABO_PRODUCTION_AUTO_DEPLOY') in ('obsidian-4484', 'new-articles'):
            result = apply(collection=os.environ['COMFYLABO_PRODUCTION_AUTO_DEPLOY'] == 'new-articles')
        else:
            raise ValueError('Production automation is disabled')
        if not result.startswith(('No ', 'Another ')):
            record(result)
        print(result)
    except Exception:
        message = 'Production operation failed. Inspect settings, state, and retained versions before retrying.'
        if (os.environ.get('COMFYLABO_PRODUCTION_AUTO_DEPLOY') in ('obsidian-4484', 'new-articles') or
                os.environ.get('COMFYLABO_PRODUCTION_APPROVED') in ('obsidian-4484', 'new-articles')):
            try:
                record(message)
            except Exception:
                pass
        sys.exit(message)
