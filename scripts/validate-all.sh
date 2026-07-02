#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VALIDATOR="$HOME/.codex/skills/.system/skill-creator/scripts/quick_validate.py"

validate_skill() {
  skill=$1

  if python3 -c 'import yaml' >/dev/null 2>&1; then
    python3 "$VALIDATOR" "$skill"
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

node --test "$ROOT"/tests/sliced-dev/dev-plan.test.mjs
