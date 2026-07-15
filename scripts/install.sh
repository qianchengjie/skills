#!/bin/sh
set -eu

ARCHIVE_URL="${SKILLS_ARCHIVE_URL:-https://github.com/qianchengjie/skills/archive/refs/heads/master.tar.gz}"
TMP_DIR=

cleanup() {
  [ -z "$TMP_DIR" ] || rm -rf "$TMP_DIR"
}

trap cleanup EXIT HUP INT TERM

has_skills() {
  for skill in "$1"/skills/*; do
    [ -f "$skill/SKILL.md" ] && return 0
  done
  return 1
}

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." 2>/dev/null && pwd || pwd)

if ! has_skills "$ROOT"; then
  command -v curl >/dev/null 2>&1 || {
    echo "curl is required for remote install" >&2
    exit 1
  }

  TMP_DIR=$(mktemp -d)
  archive="$TMP_DIR/skills.tar.gz"
  curl -fsSL "$ARCHIVE_URL" -o "$archive"
  tar -xzf "$archive" -C "$TMP_DIR"
  ROOT=$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | sed -n '1p')
fi

DEST="$HOME/.agents/skills"

mkdir -p "$DEST"

installed=0
for skill in "$ROOT"/skills/*; do
  [ -f "$skill/SKILL.md" ] || continue
  name=$(basename "$skill")
  rm -rf "$DEST/$name"
  cp -R "$skill" "$DEST/$name"
  installed=1
done

[ "$installed" -eq 1 ] || {
  echo "No skills found under $ROOT/skills" >&2
  exit 1
}

printf 'Installed skills to %s\n' "$DEST"
