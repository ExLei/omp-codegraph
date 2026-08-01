#!/usr/bin/env bash
# Install omp-codegraph extension + skill into the local environment.
# Usage: ./install.sh
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$HOME/.omp/agent/extensions"
mkdir -p "$HOME/.claude/skills/codegraph"

cp "$SRC/extensions/codegraph.ts" "$HOME/.omp/agent/extensions/codegraph.ts"
cp "$SRC/skills/codegraph/SKILL.md" "$HOME/.claude/skills/codegraph/SKILL.md"

echo "Installed:"
echo "  ~/.omp/agent/extensions/codegraph.ts"
echo "  ~/.claude/skills/codegraph/SKILL.md"
echo "Note: running omp sessions keep the extension version loaded at process start;"
echo "      restart omp (or reload agents) for changes to take effect."
