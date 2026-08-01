#!/usr/bin/env bash
# Pull the latest version from the remote and reinstall.
# Usage: ./update.sh
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"

git -C "$SRC" pull --ff-only
"$SRC/install.sh"
