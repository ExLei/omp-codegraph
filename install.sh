#!/usr/bin/env bash
# Install omp-codegraph: codegraph CLI + extension + skill.
# Usage: ./install.sh
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"

# 1) codegraph CLI (npm global, user-local prefix — no sudo needed)
if command -v codegraph >/dev/null 2>&1; then
  CG_VER="$(codegraph --version 2>/dev/null || echo '?')"
  echo "codegraph CLI: $(command -v codegraph) (v${CG_VER})"
else
  echo "codegraph CLI not found — installing via npm (prefix ~/.local)..."
  if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: npm not found. Install Node.js first." >&2
    exit 1
  fi
  npm install -g --prefix "$HOME/.local" @colbymchenry/codegraph
  if ! command -v codegraph >/dev/null 2>&1; then
    echo "ERROR: codegraph still not on PATH after install." >&2
    echo "       Add ~/.local/bin to PATH (it holds npm global binaries)." >&2
    exit 1
  fi
  echo "codegraph CLI installed: $(command -v codegraph) (v$(codegraph --version 2>/dev/null))"
fi

# 2) extension + skill
mkdir -p "$HOME/.omp/agent/extensions"
mkdir -p "$HOME/.claude/skills/codegraph"
cp "$SRC/extensions/codegraph.ts" "$HOME/.omp/agent/extensions/codegraph.ts"
cp "$SRC/skills/codegraph/SKILL.md" "$HOME/.claude/skills/codegraph/SKILL.md"

echo "Installed:"
echo "  ~/.omp/agent/extensions/codegraph.ts"
echo "  ~/.claude/skills/codegraph/SKILL.md"
echo "Note: running oh-my-pi sessions keep the extension version loaded at process start;"
echo "      restart oh-my-pi (or reload agents) for changes to take effect."
