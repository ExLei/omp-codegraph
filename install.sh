#!/usr/bin/env bash
# Install omp-codegraph: codegraph CLI + extension + skill.
# Usage: ./install.sh
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"

# 1) codegraph CLI — official self-contained installer first (no Node needed),
#    npm as fallback when curl is unavailable or the download fails.
if command -v codegraph >/dev/null 2>&1; then
  CG_VER="$(codegraph --version 2>/dev/null || echo '?')"
  echo "codegraph CLI: $(command -v codegraph) (v${CG_VER})"
else
  echo "codegraph CLI not found — installing..."
  CG_INSTALLER="https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh"
  if command -v curl >/dev/null 2>&1 && curl -fsSL "$CG_INSTALLER" | sh; then
    echo "Installed via official self-contained installer (bundle in ~/.codegraph, launcher in ~/.local/bin)."
  elif command -v npm >/dev/null 2>&1; then
    echo "curl installer unavailable/failed — falling back to npm (prefix ~/.local)..."
    npm install -g --prefix "$HOME/.local" @colbymchenry/codegraph
  else
    echo "ERROR: neither curl nor npm available. Install curl (or Node.js for npm) first." >&2
    exit 1
  fi
  if ! command -v codegraph >/dev/null 2>&1; then
    echo "ERROR: codegraph still not on PATH after install." >&2
    echo "       Add ~/.local/bin to PATH (both install paths symlink codegraph there)." >&2
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
