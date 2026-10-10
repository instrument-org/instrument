#!/usr/bin/env bash
# SessionStart hook: bootstrap a fresh Claude Code worktree.
#
# Runs on every session start but no-ops unless we're in a *linked* worktree
# (claude --worktree, subagent isolation: worktree, or Agent Teams). It carries
# over the env files `git worktree add` does not, then runs scripts/prepare.ts
# for the rest (registry/, dependencies, the Mac bridge).
#
# Also runnable by hand against a worktree created with plain `git worktree
# add` (which the hooks never see): worktree-setup.sh <path-to-worktree>
#
# Idempotent: copies env files only when missing, and prepare is a quick no-op
# on a ready checkout. stdout is surfaced to the agent as session context.
set -euo pipefail

if [[ $# -ge 1 ]]; then
  cd "$1"
fi

git_dir=$(git rev-parse --git-dir 2> /dev/null || true)
git_common_dir=$(git rev-parse --git-common-dir 2> /dev/null || true)

# In the primary worktree these resolve to the same path. Differ => linked worktree.
if [[ -z "$git_dir" || "$git_dir" == "$git_common_dir" ]]; then
  exit 0
fi

worktree_root=$(git rev-parse --show-toplevel)
# The main worktree is the first entry of `git worktree list --porcelain`.
main_root=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')

if [[ -z "$main_root" || "$main_root" == "$worktree_root" ]]; then
  exit 0
fi

echo "[worktree-setup] bootstrapping $(basename "$worktree_root") from $main_root"

normalize_registry_env_paths() {
  local src=$1
  local dest=$2
  local tmp

  tmp=$(mktemp)
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      MAIN_VITE_APP_REGISTRY_DIR_PATH=* | APP_REGISTRY_DIR_PATH=*)
        local key=${line%%=*}
        local value=${line#*=}
        if [[ -n "$value" && "$value" != /* ]]; then
          value=$(cd "$(dirname "$src")" && pwd -P)/$value
          if [[ -d "$value" ]]; then
            value=$(cd "$value" && pwd -P)
          fi
          line="$key=$value"
        fi
        ;;
    esac
    printf '%s\n' "$line" >> "$tmp"
  done < "$dest"

  mv "$tmp" "$dest"
}

# 1. Copy gitignored env files from the main worktree (same relative paths).
copied=0
while IFS= read -r -d '' src; do
  rel=${src#"$main_root"/}
  dest="$worktree_root/$rel"
  if [[ ! -e "$dest" ]]; then
    mkdir -p "$(dirname "$dest")"
    cp "$src" "$dest"
    normalize_registry_env_paths "$src" "$dest"
    copied=$((copied + 1))
  fi
done < <(
  find "$main_root" \
    \( -name node_modules -o -name .git -o -path "*/.claude/worktrees" \) -prune -o \
    -type f \( -name '.env' -o -name '.env.*' \) -print0
)
[[ $copied -gt 0 ]] && echo "[worktree-setup] copied $copied env file(s)"

# 2. Everything else a checkout needs (submodules, dependencies, the Mac
# bridge), by the same step a person's `pnpm studio` takes. Non-fatal: the
# session starts either way, and says what is missing.
node "$worktree_root/scripts/prepare.ts" \
  || echo "[worktree-setup] WARN prepare failed (run: node scripts/prepare.ts)"

exit 0
