#!/bin/sh
# Apply translated files onto the installed deepseek-herness-kanban package.
set -eu

PKG=${PKG:-$HOME/.dsh/profiles/web/node_modules/deepseek-herness-kanban}
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUT="$DIR/out"

[ -d "$PKG" ] || { echo "error: $PKG not found" >&2; exit 1; }

BAK="$PKG.bak-$(date +%Y%m%d-%H%M%S)"
cp -r "$PKG" "$BAK"

copy() { # copy DEST_DIR SRCNAME... — warn on missing files, keep going
  dest=$1; shift
  for f in "$@"; do
    if [ -f "$OUT/$f" ]; then cp "$OUT/$f" "$dest/" || return 1
    else echo "warning: $OUT/$f missing, skipped" >&2; fi
  done
}

copy "$PKG/client/src" client/src/Board.tsx client/src/api.ts client/src/entry.tsx
copy "$PKG/client" client/index.js
copy "$PKG/lib" lib/service.js lib/status.js lib/types.js lib/scheduler.js lib/index.js lib/service.d.ts
copy "$PKG/skill" skill/SKILL.md

echo "Applied. Backup: $BAK"
echo "Hard-refresh the browser (Ctrl+Shift+R) to pick up the changes."
