#!/usr/bin/env bash
# Lands the worktree you are in on a branch, main unless told otherwise: brings
# the local branch up to its remote, rebases the worktree's branch onto it,
# checks what it changed, fast-forwards the branch in the checkout that has it,
# pushes it, then removes the worktree and its branch.
#
#   scripts/land.sh [--onto <branch>] [--keep] [--no-push]
#
# Run from inside a linked worktree. The checks are the ones CI would fail on
# for what the branch changed: types in the packages it touched, lint in the
# files it changed, unused code (knip) anywhere, the tests that import what it
# changed (vitest related), and the tests marked `// land: every landing`
# (ones that read source as text, which vitest related cannot trace). It also
# lists the Commits-to: contracts of the commits whose lines the branch changes.
# When the target moves during the checks it rebases and checks again, and it
# waits for another session's uncommitted edits to files the branch changes
# rather than touch them; those are that session's work, so never discard or
# stash them to get a landing through. The push takes every commit the local
# target holds, other sessions' included, and is never forced. --no-push lands
# locally without pushing. --keep leaves the worktree and branch in place after
# landing.
set -euo pipefail

keep=false
push=true
target=main
while (($# > 0)); do
  case "$1" in
    --keep) keep=true ;;
    --no-push) push=false ;;
    --onto)
      target=${2:-}
      [[ -n "$target" ]] || { echo "land: --onto needs a branch" >&2; exit 1; }
      shift
      ;;
    *)
      echo "usage: scripts/land.sh [--onto <branch>] [--keep] [--no-push]" >&2
      exit 1
      ;;
  esac
  shift
done

fail() {
  echo "land: $1" >&2
  exit 1
}

worktree_root=$(git rev-parse --show-toplevel)
main_root=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
# Where the target is checked out, which is the only place it can be
# fast-forwarded without leaving that checkout's files behind.
target_root=$(git worktree list --porcelain | awk -v ref="branch refs/heads/$target" '
  /^worktree /{root = substr($0, 10)} $0 == ref {print root; exit}')
[[ "$worktree_root" != "$main_root" ]] ||
  fail "run this from a linked worktree, not the primary checkout"
# The checks below name files from the repo's top, wherever this was run from.
cd "$worktree_root"

# A worktree made with plain `git worktree add` has had no setup hook run.
if [[ ! -d "$worktree_root/node_modules" ]]; then
  echo "land: setting up $worktree_root first"
  bash "$main_root/.claude/hooks/worktree-setup.sh" "$worktree_root" > /dev/null
fi

branch=$(git branch --show-current)
[[ -n "$branch" ]] || fail "the worktree is on a detached HEAD; commit on a branch first"
[[ "$branch" != "$target" ]] || fail "this worktree is on $target itself; commit on a branch to land"
[[ -n "$target_root" ]] || fail "no checkout is on $target; check it out somewhere first"
# Untracked files count: removing the worktree once it lands deletes them.
uncommitted() {
  git -C "$worktree_root" status --porcelain --ignore-submodules=untracked
}
if [[ -n "$(uncommitted)" ]]; then
  echo "land: commit or drop the worktree's changes first, new files included:" >&2
  uncommitted >&2
  exit 1
fi

# One landing at a time across every worktree: each runs the full checks, and
# a landing that moves a target under another sends that one round its checks
# again, so running them side by side multiplies the work instead of sharing it.
source "$main_root/scripts/check-slots.sh"
take_check_slot land 1 "${LAND_QUEUE_SECONDS:-1800}" ||
  fail "another landing held the queue for ${check_slot_waited}s; rerun once it finishes"

# Moves the local target up to its remote. Two that each hold commits the other
# lacks are left for a person to merge.
sync_target() {
  git ls-remote --exit-code --heads origin "refs/heads/$target" > /dev/null || {
    (($? == 2)) && return 0
    fail "could not reach origin to check $target; --no-push lands locally"
  }
  git fetch --quiet origin "+refs/heads/$target:refs/remotes/origin/$target"
  git merge-base --is-ancestor "origin/$target" "$target" && return 0
  git merge-base --is-ancestor "$target" "origin/$target" ||
    fail "local $target and origin/$target have diverged; merge origin/$target in $target_root, then rerun"
  git -C "$target_root" merge --ff-only --quiet "origin/$target" ||
    fail "could not fast-forward $target to origin in $target_root; uncommitted edits there are another session's work, so never discard them"
  echo "land: brought local $target up to origin"
}
if [[ "$push" == true ]]; then
  sync_target
fi

# The target may have moved since the worktree started; commits it already holds
# under other hashes drop out of the rebase.
rebase_onto_target() {
  git rebase --quiet "$target" ||
    fail "rebasing $branch onto $target stopped on a conflict; resolve it in $worktree_root, git rebase --continue, then rerun"
  # A rebase moves registry/'s pin without checking it out, which would leave
  # the worktree reading as changed and refuse the next run.
  git submodule update --quiet --init registry
}
rebase_onto_target
checked_base=$(git rev-parse "$target")
changed=$(git diff --name-only "$target"...HEAD)
[[ -n "$changed" ]] || fail "nothing on $branch that $target does not already have"
echo "land: $(git rev-list --count "$target"..HEAD) commit(s) on $branch"

# The Commits-to trailers of the commits that wrote the lines this branch
# changes or removes, so a contract one of them made is in view before landing
# rather than found broken by a later review. Shown, never enforced.
node -e '
  const { execFileSync } = require("node:child_process");
  const target = process.argv[1];
  const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });
  const writers = new Set();
  // A renamed file is blamed under the name the target has it by.
  for (const entry of git("diff", "--name-status", "--diff-filter=MDR", `${target}...HEAD`).split("\n").filter(Boolean)) {
    const [, file, renamed = file] = entry.split("\t");
    const hunks = git("diff", "-U0", `${target}...HEAD`, "--", file, renamed).matchAll(/^@@ -(\d+)(?:,(\d+))? /gm);
    for (const [, start, count = "1"] of hunks) {
      if (count === "0") continue;
      const blame = git("blame", "--porcelain", "-L", `${start},+${count}`, target, "--", file);
      for (const [, sha] of blame.matchAll(/^([0-9a-f]{40}) \d+ \d+/gm)) writers.add(sha);
    }
  }
  const found = [];
  for (const sha of writers) {
    const [subject, ...body] = git("log", "-1", "--format=%B", sha).split("\n");
    // A value wrapped onto unindented lines still reads as one contract, up to
    // the next trailer; a wrapped line that only looks like `Word: ...` is prose.
    let contract;
    for (const line of [...body, ""]) {
      if (contract !== undefined && line.trim() !== "" && !/^(Rejected|Commits-to|Not-tested|Tested|Related|Review|Upstream|Co-Authored-By|Signed-off-by): /i.test(line)) {
        contract += " " + line.trim();
        continue;
      }
      if (contract !== undefined) found.push(`  ${sha.slice(0, 9)} ${subject}\n    ${contract}`);
      contract = line.match(/^Commits-to: (.+)$/)?.[1];
    }
  }
  if (found.length > 0) {
    console.log("land: commits whose lines this branch changes made these contracts; check it keeps them:\n" + found.join("\n"));
  }
' "$target"

# What CI would fail on for what the branch changed. The target moving under a
# landing runs it again, all of it when the target changed a file the branch did
# and the types alone otherwise.
check_types() {
  pnpm exec turbo run check:types --filter="[$target]" --output-logs errors-only
}
run_checks() {
  # Types across every package the branch touched, since a changed signature
  # breaks callers in files it never opened; lint over the changed files alone,
  # from the root so each resolves its own package config, since what other work
  # left on the target is not this branch's to fix.
  check_types
  lintable=$(grep -E '\.(ts|tsx|mjs|cjs|js|jsx)$' <<< "$changed" | while read -r file; do
    [[ -f "$file" ]] && echo "$file"
  done || true)
  if [[ -n "$lintable" ]]; then
    # shellcheck disable=SC2086
    pnpm exec oxlint --type-aware --quiet --no-error-on-unmatched-pattern $lintable
  fi
  # Links and cited paths in docs/ and the docs indexes: a rename in code is
  # what breaks a doc, so a branch that renames fixes the docs it broke.
  node scripts/docs.ts || fail "docs/ has broken links or a stale index; fix what is printed (\`pnpm fix\` rewrites the indexes)"
  # Unused code anywhere, as CI checks it: deleting a caller leaves an export
  # unused in a file the branch never opened. Each finding is a line to fix.
  pnpm exec knip || fail "knip finds unused code; fix it before landing, wherever it is"

  # The tests that import a changed source file, and the ones marked
  # `// land: every landing`, which read source as text and so are related to
  # no change, run in the package that owns them and in the projects its
  # test:ci runs (Studio's browser project is not).
  for package in apps/studio packages/workspace packages/ai-gateway packages/shared; do
    files=$({
      grep -E "^$package/.*\.(ts|tsx)$" <<< "$changed" || true
      git grep -l '^// land: every landing' -- "$package" || true
    } | sed "s#^$package/##" | sort -u)
    if [[ -n "$files" && -f "$package/vitest.config.ts" ]]; then
      projects=()
      if [[ "$package" == "apps/studio" ]]; then
        projects=(--project node --project dom)
      fi
      # shellcheck disable=SC2086
      (cd "$package" && CI=true pnpm exec vitest related --run --passWithNoTests \
        ${projects[@]+"${projects[@]}"} $files)
    fi
  done
}
run_checks

# Fast-forwarding refuses to update a file with uncommitted changes in the
# target checkout. Those are another session's edits, so wait for it to commit
# them; discarding or stashing them would throw its work away.
wait_for_target() {
  local waited=0 updates blocking
  while true; do
    updates=$(git diff --name-only "$target" HEAD)
    [[ -n "$updates" ]] || return 0
    # shellcheck disable=SC2086
    blocking=$({
      git -C "$target_root" diff --name-only HEAD -- $updates
      git -C "$target_root" ls-files --others --exclude-standard -- $updates
    } | sort -u)
    [[ -z "$blocking" ]] && return 0
    if ((waited >= ${LAND_WAIT_SECONDS:-600})); then
      fail "another session still has uncommitted edits to files this branch changes, so $target was left alone. They are its work: never discard or stash them. Rerun once it commits them:
$blocking"
    fi
    if ((waited == 0)); then
      echo "land: waiting for another session to commit its edits in $target_root to:"
      sed 's/^/  /' <<< "$blocking"
    fi
    sleep 15
    waited=$((waited + 15))
  done
}

# The target keeps moving while the checks run, so rebase onto wherever it went and
# check again before fast-forwarding.
for attempt in 1 2 3 4 5 6; do
  wait_for_target
  if [[ "$push" == true ]]; then
    sync_target
  fi
  git -C "$target_root" merge --ff-only --quiet "$branch" 2> /dev/null && break
  ((attempt < 6)) || fail "$target kept moving under the landing; rerun"
  [[ "$(git rev-parse "$target")" != "$checked_base" ]] || continue
  moved=$(git diff --name-only "$checked_base" "$target")
  rebase_onto_target
  checked_base=$(git rev-parse "$target")
  changed=$(git diff --name-only "$target"...HEAD)
  [[ -n "$changed" ]] || fail "$target already has everything on $branch"
  if [[ -n "$(comm -12 <(sort <<< "$moved") <(sort <<< "$changed"))" ]]; then
    echo "land: $target moved and changed files this branch changes; checking again"
    run_checks
  else
    echo "land: $target moved; checking types again"
    check_types
  fi
done
echo "land: $target is at $(git -C "$target_root" log -1 --format='%h %s')"

# Fast-forwarding moves the target checkout's lockfile, not its node_modules.
if grep -qx 'pnpm-lock.yaml' <<< "$changed"; then
  (cd "$target_root" && pnpm install --frozen-lockfile --reporter=silent)
  echo "land: installed the new lockfile in $target_root"
fi

if [[ "$push" == true ]]; then
  git -C "$target_root" push --quiet origin "refs/heads/$target:refs/heads/$target" ||
    fail "landed on local $target, but the push failed and the worktree was kept; fix what it printed, then run: git -C \"$target_root\" push origin $target"
  echo "land: pushed $target"
fi
release_check_slot

# A worktree Claude Code made for a subagent stays locked while the subagent
# runs, and the harness removes it once the subagent is done.
if [[ "$keep" == false ]] &&
  git worktree list --porcelain | grep -A5 -Fx "worktree $worktree_root" | grep -q '^locked'; then
  echo "land: $worktree_root is locked by the harness, which removes it later"
  keep=true
fi

# Files written while the checks ran are on no branch.
if [[ "$keep" == false && -n "$(uncommitted)" ]]; then
  echo "land: kept $worktree_root, which has changes no commit holds:" >&2
  uncommitted >&2
  keep=true
fi

if [[ "$keep" == false ]]; then
  cd "$main_root"
  # --force because git refuses to remove a worktree holding a submodule
  # (registry/), clean or not; the branch is on the target by now.
  git worktree remove --force "$worktree_root"
  git branch --quiet -D "$branch"
  echo "land: removed $worktree_root and $branch"
fi
