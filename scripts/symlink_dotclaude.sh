#!/usr/bin/env bash
# Mirror every leaf file under dotclaude_folder/ into .claude/ as a relative symlink.
#
# dotclaude_folder/ is the version-controlled source of truth for this project's
# Claude Code configuration; .claude/ is the directory the harness actually reads.
# Re-run this after adding files to dotclaude_folder/. It is idempotent: existing
# symlinks are replaced in place, and a real file at a target path is never clobbered.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

src_root="dotclaude_folder"
dest_root=".claude"

find "$src_root" -type f | while read -r src; do
        rel="${src#"$src_root"/}"
        dest="$dest_root/$rel"
        if [ -e "$dest" ] && [ ! -L "$dest" ]; then
                echo "skip (real file exists): $dest"
                continue
        fi
        mkdir -p "$(dirname "$dest")"
        target="$(python3 -c 'import os, sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "$src" "$(dirname "$dest")")"
        ln -sfn "$target" "$dest"
        echo "linked: $dest -> $target"
done
