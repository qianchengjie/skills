#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VALIDATOR="$HOME/.codex/skills/.system/skill-creator/scripts/quick_validate.py"
INVOCATION_VALIDATOR="$ROOT/scripts/validate-skill-invocation.mjs"
TMP_DIR=

cleanup() {
  [ -z "$TMP_DIR" ] || rm -rf "$TMP_DIR"
}

trap cleanup EXIT HUP INT TERM

validate_skill() {
  skill=$1

  node "$INVOCATION_VALIDATOR" "$skill"

  if python3 -c 'import yaml' >/dev/null 2>&1; then
    [ -n "$TMP_DIR" ] || TMP_DIR=$(mktemp -d)
    projected_skill="$TMP_DIR/$(basename "$skill")"
    mkdir -p "$projected_skill"
    awk '
      NR == 1 && $0 == "---" { in_frontmatter = 1; print; next }
      in_frontmatter && $0 == "---" { in_frontmatter = 0; print; next }
      in_frontmatter && $0 ~ /^disable-model-invocation:[[:space:]]*(true|false)[[:space:]]*$/ { next }
      { print }
    ' "$skill/SKILL.md" > "$projected_skill/SKILL.md"
    python3 "$VALIDATOR" "$projected_skill"
    return
  fi

  md="$skill/SKILL.md"
  name=$(basename "$skill")

  [ -f "$md" ] || {
    echo "$skill: missing SKILL.md" >&2
    exit 1
  }

  [ "$(sed -n '1p' "$md")" = "---" ] || {
    echo "$md: missing YAML frontmatter start" >&2
    exit 1
  }

  grep -q "^name: $name$" "$md" || {
    echo "$md: name must be '$name'" >&2
    exit 1
  }

  grep -q '^description: .' "$md" || {
    echo "$md: missing description" >&2
    exit 1
  }

  echo "$skill: ok (fallback validation; PyYAML unavailable)"
}

for skill in "$ROOT"/skills/*; do
  [ -d "$skill" ] || continue
  validate_skill "$skill"
done

find "$ROOT/tests" -type f -name '*.test.mjs' -exec node --test {} +
