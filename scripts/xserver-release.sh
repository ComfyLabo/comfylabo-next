#!/bin/sh
# 新システム専用ディレクトリだけを操作する。既存サイトの公開入口は変更しない。
set -eu
root=${1:?release root required}
action=${2:?action required}
version=${3:-}
case "$root" in /*/comfylabo-next) ;; *) echo 'Invalid release root' >&2; exit 1;; esac
case "$root" in *'/../'*|*'/./'*|*' '*) echo 'Invalid release root' >&2; exit 1;; esac
[ ! -L "$root" ] || { echo 'Release root must not be a symlink' >&2; exit 1; }
if [ "$action" = prepare ] && [ ! -e "$root" ]; then
  mkdir "$root"
  printf 'comfylabo-simple-v1\n' > "$root/.comfylabo-simple"
fi
[ -f "$root/.comfylabo-simple" ] || { echo 'Unmanaged directory; refusing changes' >&2; exit 1; }
[ "$(cat "$root/.comfylabo-simple")" = comfylabo-simple-v1 ] || exit 1
cd "$root"

replace_link() {
  # mvのリンク先ディレクトリへの移動を避け、リンクそのものを置き換える。
  if [ "$(uname -s)" = Darwin ]; then mv -fh "$1" "$2"; else mv -fT "$1" "$2"; fi
}
valid_target() {
  case "$1" in releases/*) ;; *) return 1;; esac
  name=${1#releases/}
  case "$name" in ''|*[!A-Za-z0-9.-]*|.|..) return 1;; esac
}
verify() {
  valid_target "$1" || return 1
  [ ! -L releases ] || return 1
  [ ! -L "$1" ] && [ -d "$1" ] || return 1
  for file in index.html styles.css comfylabo-logo.jpg SHA256SUMS; do
    [ -s "$1/$file" ] && [ ! -L "$1/$file" ] || return 1
  done
  (cd "$1" && sha256sum -c SHA256SUMS)
}
trap 'rm -f ".next-current-$$" ".next-previous-$$"' EXIT HUP INT TERM
case "$action" in
  prepare)
    case "$version" in ''|*[!A-Za-z0-9.-]*|.|..) exit 1;; esac
    command -v sha256sum >/dev/null
    mkdir -p releases
    [ ! -L releases ] || exit 1
    mkdir "releases/$version"
    ;;
  activate|rollback)
    for link in current previous; do
      if [ -e "$link" ] || [ -L "$link" ]; then [ -L "$link" ] || exit 1; fi
    done
    if [ "$action" = rollback ]; then
      target=$(readlink previous)
    else
      target="releases/$version"
    fi
    verify "$target"
    old=''
    if [ -L current ]; then old=$(readlink current); valid_target "$old" || exit 1; fi
    [ "$target" != "$old" ] || exit 0
    if [ -n "$old" ]; then
      ln -s "$old" ".next-previous-$$"
      replace_link ".next-previous-$$" previous
    fi
    ln -s "$target" ".next-current-$$"
    replace_link ".next-current-$$" current
    printf 'Current release: %s\n' "$target"
    ;;
  *) echo 'Unknown action' >&2; exit 1;;
esac
