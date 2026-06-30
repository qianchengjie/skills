#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DEST="${CODEX_HOME:-$HOME/.codex}/skills"

mkdir -p "$DEST"

for skill in "$ROOT"/skills/*; do
  [ -d "$skill" ] || continue
  name=$(basename "$skill")
  rm -rf "$DEST/$name"
  cp -R "$skill" "$DEST/$name"
done

printf 'Installed skills to %s\n' "$DEST"
