"""Explicit collection format; existing single-article receivers reject it by default."""
import json
import re
from production_deploy import ARTICLE, BASE, IMAGE, digest

TARGET = 'https://comfylabo.com'
LEGACY_FILE = 'legacy/4484/index.html'
POST_FILE = re.compile(r'posts/[a-z0-9]+(?:-[a-z0-9]+)*/index\.html')
MAX_FILES = 3 + 101 * 11


def allowed_file(name):
    return name in BASE or name == LEGACY_FILE or IMAGE.fullmatch(name) or POST_FILE.fullmatch(name)


def validate(files):
    manifest = json.loads(files['manifest.json'].decode('utf-8'))
    if (manifest.get('version') != 4 or manifest.get('kind') != 'production-collection' or
            manifest.get('target') != TARGET or manifest.get('postId') != ARTICLE or
            manifest.get('source') != {'kind': 'sanity-published', 'projectId': '0lwnb6yi', 'dataset': 'production'}):
        raise ValueError('Unexpected production collection')
    posts = manifest.get('posts')
    if not isinstance(posts, list) or not 1 <= len(posts) <= 101:
        raise ValueError('Unexpected article count')
    ids, slugs, required = set(), set(), set(BASE) | {LEGACY_FILE}
    legacy = None
    for post in posts:
        identifier, revision, slug = post.get('id'), post.get('revision'), post.get('slug')
        if (not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', identifier) or
                identifier.startswith(('drafts.', 'versions.')) or identifier == 'comfylabo-mvp-welcome' or
                not isinstance(revision, str) or not revision.strip() or
                not isinstance(slug, str) or len(slug) > 96 or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug) or
                identifier in ids or slug in slugs):
            raise ValueError('Invalid collection identity')
        ids.add(identifier)
        slugs.add(slug)
        if identifier == ARTICLE:
            if slug != '4484':
                raise ValueError('Legacy URL must stay unchanged')
            legacy = post
        else:
            if post.get('publicationSystem') != 'comfylabo-next':
                raise ValueError('Unapproved legacy migration')
            required.add('posts/' + slug + '/index.html')
    if legacy is None or manifest.get('revision') != legacy['revision']:
        raise ValueError('Existing production article is missing')
    expected = manifest.get('files', {})
    if (not isinstance(expected, dict) or not required.issubset(expected) or
            len(expected) > len(required) + len(posts) * 10 or
            any(n not in required and not IMAGE.fullmatch(n) for n in expected) or
            set(files) != set(expected) | {'manifest.json'}):
        raise ValueError('Unexpected collection files')
    for name, checksum in expected.items():
        data = files[name]
        if not data or digest(data) != checksum or (IMAGE.fullmatch(name) and name[6:70] != checksum):
            raise ValueError('Collection checksum mismatch')
    if sum(map(len, files.values())) > 10 * 1024 * 1024:
        raise ValueError('Collection too large')
    return manifest


def routes(manifest):
    result = [{'url': '/readings/', 'file': 'index.html'}, {'url': '/4484/', 'file': LEGACY_FILE}]
    result.extend({'url': '/posts/' + p['slug'] + '/', 'file': 'posts/' + p['slug'] + '/index.html'}
                  for p in manifest['posts'] if p['id'] != ARTICLE)
    for name in sorted(manifest['files']):
        if name in {'styles.css', 'comfylabo-logo.jpg'} or IMAGE.fullmatch(name):
            # Keep previously published asset URLs valid for cached HTML and existing links.
            result.extend([{'url': '/readings/' + name, 'file': name}, {'url': '/4484/' + name, 'file': name}])
    return sorted(result, key=lambda r: r['url'])


def preserve_articles(previous, incoming):
    if incoming.get('version') != 4:
        return
    old = previous.get('posts', [{'id': ARTICLE, 'slug': '4484'}])
    new = {p['id']: p['slug'] for p in incoming['posts']}
    if any(new.get(p['id']) != p['slug'] for p in old):
        raise ValueError('Article removal or URL change requires separate approval')
