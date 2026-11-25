"""Single-article default with an explicit collection opt-in; guarded CLI writes."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile
import urllib.request

ARTICLE = '6a6732df-f6d2-434e-9fca-7e745ad0b11a'
URL = 'https://comfylabo.com/4484/'
NAMESPACE = '_comfy_next_4484'
PUBLIC = Path('/home/comfylabo/comfylabo.com/public_html')
PRIVATE = Path('/home/comfylabo/comfylabo-next-production')
BASE = {'index.html', 'styles.css', 'comfylabo-logo.jpg'}
IMAGE = re.compile(r'^image-([a-f0-9]{64})\.(?:jpg|png|webp)$')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def regular(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError('Expected a regular file')
    return path.read_bytes()


def real_directory(path):
    if path.is_symlink() or not path.is_dir():
        raise ValueError('Expected a real directory')


def legacy_file(public, legacy):
    target = public / legacy.lstrip('/')
    for parent in target.parents:
        if parent == public:
            break
        real_directory(parent)
    return target


def expected_routing(before, files, directory, manifest=None):
    text = before.decode('utf-8')
    pattern = r'^RewriteCond %\{REQUEST_URI\} \^/4484/\$\r?\nRewriteRule \^ "/_comfy_release_[a-f0-9]+/public-files\.review/4484/index\.html" \[END\]'
    matches = list(re.finditer(pattern, text, re.M))
    if len(matches) != 1 or NAMESPACE in text:
        raise ValueError('Unexpected original routing')
    newline = '\r\n' if '\r\n' in text else '\n'
    block = ['# BEGIN ComfyLabo article 4484', 'RewriteRule ^' + NAMESPACE + '(?:/|$) - [R=404,END]']
    if manifest and manifest.get('version') == 4:
        from production_collection import routes as collection_routes
        if re.search(r'^RewriteCond %\{REQUEST_URI\} \^/(?:posts|readings)(?:/|\$)', text, re.M):
            raise ValueError('Existing routes conflict with new collection')
        routes = collection_routes(manifest)
    else:
        routes = [{'url': '/4484/' if name == 'index.html' else '/4484/' + name, 'file': name} for name in sorted(files)]
    for route in routes:
        url, name = route['url'], route['file']
        block.extend(['RewriteCond %{REQUEST_URI} ^' + url.replace('.', '\\.') + '$', 'RewriteRule ^ "/' + directory + '/' + name + '" [END]'])
    if manifest and manifest.get('version') == 4:
        for route in routes:
            if route['url'].endswith('/') and route['url'] != '/4484/':
                short = route['url'][:-1]
                block.extend(['RewriteCond %{REQUEST_URI} ^' + short + '$', 'RewriteRule ^ https://comfylabo.com' + route['url'] + ' [R=301,END]'])
    block.append('# END ComfyLabo article 4484')
    m = matches[0]
    return (text[:m.start()] + newline.join(block) + text[m.end():]).encode('utf-8'), routes, re.search(r'"(/[^"\n]+)"', m.group()).group(1)


def validate_article(files, collection=False):
    raw = files['manifest.json']
    manifest = json.loads(raw.decode('utf-8'))
    if collection and manifest.get('version') == 4:
        from production_collection import validate
        return validate(files)
    source = manifest.get('source', {})
    if (manifest.get('version') != 3 or manifest.get('kind') != 'production-article-candidate' or manifest.get('target') != URL or
            manifest.get('postId') != ARTICLE or manifest.get('slug') != '4484' or
            not isinstance(manifest.get('revision'), str) or not manifest['revision'].strip() or
            source != {'kind': 'sanity-published', 'projectId': '0lwnb6yi', 'dataset': 'production'}):
        raise ValueError('Unexpected article or source')
    expected = manifest.get('files', {})
    if not isinstance(expected, dict) or not BASE.issubset(expected) or len(expected) > 13 or any(n not in BASE and not IMAGE.fullmatch(n) for n in expected):
        raise ValueError('Unexpected file names')
    if set(files) != set(expected) | {'manifest.json'}:
        raise ValueError('Unexpected article files')
    for name, checksum in expected.items():
        data = files[name]
        if not data or digest(data) != checksum or (IMAGE.fullmatch(name) and IMAGE.fullmatch(name).group(1) != checksum):
            raise ValueError('Candidate checksum mismatch')
    if sum(len(v) for v in files.values()) > 10 * 1024 * 1024:
        raise ValueError('Candidate too large')
    return manifest


def load_package(package, collection=False):
    package = Path(package)
    if package.is_symlink() or not package.is_dir():
        raise ValueError('Unexpected package')
    raw = regular(package / 'manifest.json')
    manifest = json.loads(raw.decode('utf-8'))
    names = manifest.get('files', {})
    if collection:
        from production_collection import allowed_file
    else:
        allowed_file = lambda n: n in BASE or IMAGE.fullmatch(n)
    if not isinstance(names, dict) or any(not allowed_file(n) for n in names):
        raise ValueError('Unexpected file names')
    article = {'manifest.json': raw}
    article.update({name: regular(package / name) for name in names})
    validate_article(article, collection)
    files = {name: article[name] for name in names}
    plan = json.loads(regular(package / 'plan.json').decode('utf-8'))
    version = digest(raw)
    directory = NAMESPACE + '/' + version
    before, after = regular(package / 'before.htaccess'), regular(package / 'after.htaccess')
    reconstructed, routes, legacy = expected_routing(before, files, directory, manifest)
    if (plan.get('version') != 1 or plan.get('kind') != 'production-routing-plan' or plan.get('target') != manifest['target'] or
            plan.get('postId') != ARTICLE or plan.get('revision') != manifest['revision'] or plan.get('directory') != directory or
            plan.get('manifestSha256') != version or plan.get('routes') != routes or after != reconstructed or
            plan.get('beforeSha256') != digest(before) or plan.get('afterSha256') != digest(after)):
        raise ValueError('Routing plan mismatch')
    return plan, files, before, after, legacy


def managed_private(root):
    if root.is_symlink():
        raise ValueError('Unsafe private directory')
    marker = root / '.comfylabo-production-4484'
    if not root.exists():
        root.mkdir(mode=0o700)
        marker.write_text('comfylabo-production-4484\n')
        marker.chmod(0o600)
    if regular(marker).strip() != b'comfylabo-production-4484':
        raise ValueError('Unmanaged private directory')


def atomic_config(target, data, mode, gid):
    fd, name = tempfile.mkstemp(prefix='.htaccess.comfy-', dir=str(target.parent))
    try:
        with os.fdopen(fd, 'wb') as output:
            os.fchown(output.fileno(), -1, gid)
            os.fchmod(output.fileno(), mode)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, str(target))
    finally:
        if os.path.exists(name):
            os.unlink(name)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_public(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'ComfyLabo-production-check', 'Cache-Control': 'no-cache'})
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=15) as response:
        if response.status != 200:
            raise ValueError('Unexpected HTTP response')
        data = response.read(10 * 1024 * 1024 + 1)
    if len(data) > 10 * 1024 * 1024:
        raise ValueError('Unexpected response size')
    return data


def verify_public(plan, files):
    for route in plan['routes']:
        if digest(read_public('https://comfylabo.com' + route['url'])) != digest(files[route['file']]):
            raise ValueError('Public content differs')


def activate(package, public=PUBLIC, private=PRIVATE, verify=verify_public):
    plan, files, before, after, legacy = load_package(package)
    public, private = Path(public), Path(private)
    if public.is_symlink() or not public.is_dir():
        raise ValueError('Unsafe public root')
    config = public / '.htaccess'
    if regular(config) != before:
        raise ValueError('Public settings changed; refusing overwrite')
    original_stat = config.stat()
    if original_stat.st_uid != os.getuid():
        raise ValueError('Unexpected settings owner')
    legacy_bytes = regular(legacy_file(public, legacy))
    managed_private(private)
    backups = private / 'backups'
    if backups.is_symlink():
        raise ValueError('Unsafe backup root')
    backups.mkdir(exist_ok=True, mode=0o700)
    backup = backups / plan['manifestSha256']
    backup.mkdir(mode=0o700)
    for name, data in [('before.htaccess', before), ('after.htaccess', after), ('legacy.html', legacy_bytes)]:
        (backup / name).write_bytes(data)
        (backup / name).chmod(0o600)
    receipt = {'beforeSha256': digest(before), 'afterSha256': digest(after), 'legacySha256': digest(legacy_bytes),
               'mode': stat.S_IMODE(original_stat.st_mode), 'gid': original_stat.st_gid}
    (backup / 'receipt.json').write_text(json.dumps(receipt))
    (backup / 'receipt.json').chmod(0o600)
    namespace = public / NAMESPACE
    if namespace.is_symlink():
        raise ValueError('Unsafe asset directory')
    namespace.mkdir(exist_ok=True, mode=0o755)
    target = public / plan['directory']
    if target.exists() or target.is_symlink():
        raise ValueError('Release exists; inspect before retrying')
    staging = Path(tempfile.mkdtemp(prefix='.incoming-', dir=str(namespace)))
    staging.chmod(0o755)
    for name, data in files.items():
        (staging / name).write_bytes(data)
        (staging / name).chmod(0o644)
        if regular(staging / name) != data:
            raise ValueError('Copied asset mismatch')
    staging.rename(target)
    if regular(config) != before:
        raise ValueError('Public settings changed during staging')
    atomic_config(config, after, receipt['mode'], receipt['gid'])
    try:
        verify(plan, files)
        if regular(config) != after:
            raise ValueError('Public settings changed during verification')
    except Exception:
        if regular(config) == after:
            atomic_config(config, before, receipt['mode'], receipt['gid'])
            raise ValueError('Public verification failed; original settings restored')
        raise ValueError('Concurrent settings change; inspect before recovery')
    return {'activated': True, 'target': URL, 'files': len(files), 'backupId': plan['manifestSha256']}


def rollback(package, public=PUBLIC, private=PRIVATE, check=read_public):
    plan, files, before, after, legacy = load_package(package)
    public, private = Path(public), Path(private)
    real_directory(public)
    real_directory(private)
    if regular(private / '.comfylabo-production-4484').strip() != b'comfylabo-production-4484':
        raise ValueError('Unmanaged recovery directory')
    real_directory(private / 'backups')
    backup = private / 'backups' / plan['manifestSha256']
    real_directory(backup)
    receipt = json.loads(regular(backup / 'receipt.json').decode('utf-8'))
    saved = regular(backup / 'before.htaccess')
    if saved != before or receipt.get('beforeSha256') != digest(before) or receipt.get('afterSha256') != digest(after):
        raise ValueError('Recovery data mismatch')
    config = public / '.htaccess'
    if regular(config) != after:
        raise ValueError('Public settings changed; refusing rollback')
    if digest(regular(legacy_file(public, legacy))) != receipt['legacySha256']:
        raise ValueError('Legacy article changed; inspect recovery')
    atomic_config(config, before, receipt['mode'], receipt['gid'])
    if digest(check(URL)) != receipt['legacySha256']:
        raise ValueError('Original settings restored; HTTP recovery requires inspection')
    return {'restored': True, 'target': URL}


if __name__ == '__main__':
    try:
        if os.environ.get('COMFYLABO_PRODUCTION_APPROVED') != 'obsidian-4484':
            raise ValueError('Explicit production approval required')
        action, version = sys.argv[1:]
        if not re.fullmatch('[a-f0-9]{64}', version):
            raise ValueError('Invalid package version')
        incoming = PRIVATE / 'incoming' / version
        if action == 'prepare':
            managed_private(PRIVATE)
            parent = PRIVATE / 'incoming'
            if parent.is_symlink():
                raise ValueError('Unsafe incoming root')
            parent.mkdir(exist_ok=True, mode=0o700)
            incoming.mkdir(mode=0o700)
            result = {'prepared': True}
        elif action == 'activate':
            result = activate(incoming)
        elif action == 'rollback':
            result = rollback(incoming)
        else:
            raise ValueError('Unknown action')
        print(json.dumps(result))
    except Exception:
        print('本番操作を正常完了できませんでした。再試行前に現在の設定と退避データを確認してください。原稿・認証情報は表示していません。', file=sys.stderr)
        sys.exit(1)
