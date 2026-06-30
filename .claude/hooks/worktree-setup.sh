#!/usr/bin/env bash
# SessionStart hook: bootstrap a fresh Claude Code worktree.
#
# Runs on every session start but no-ops unless we're in a *linked* worktree
# (claude --worktree, subagent isolation: worktree, or Agent Teams). It carries
# over gitignored state that `git worktree add` does not: env files, the
# registry/ submodule, and installed node_modules.
#
# Idempotent: copies env files only when missing, installs only when the root
# node_modules is absent. stdout is surfaced to the agent as session context.
set -euo pipefail

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

# 2. Initialize the registry/ submodule (network; non-fatal on failure).
if [[ -f "$worktree_root/.gitmodules" ]]; then
  git -C "$worktree_root" submodule update --init --recursive \
    && echo "[worktree-setup] submodules ready" \
    || echo "[worktree-setup] WARN submodule init failed (run: git submodule update --init)"
fi

# 3. Install dependencies only if they're missing.
if [[ ! -d "$worktree_root/node_modules" ]]; then
  echo "[worktree-setup] installing dependencies (pnpm install)..."
  if command -v corepack > /dev/null 2>&1; then
    corepack pnpm -C "$worktree_root" install --prefer-offline \
      && echo "[worktree-setup] dependencies installed" \
      || echo "[worktree-setup] WARN pnpm install failed (run pnpm install manually)"
  else
    pnpm -C "$worktree_root" install --prefer-offline \
      && echo "[worktree-setup] dependencies installed" \
      || echo "[worktree-setup] WARN pnpm install failed (run pnpm install manually)"
  fi
else
  echo "[worktree-setup] node_modules present, skipping install"
fi

exit 0
