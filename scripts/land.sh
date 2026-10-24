#!/usr/bin/env bash
# Lands the worktree you are in on main: rebases its branch onto the local
# main, checks what it changed, fast-forwards main in the primary checkout,
# then removes the worktree and its branch.
#
#   scripts/land.sh [--keep]    run from inside a linked worktree
#
# The checks are the ones CI would fail on for what the branch changed:
# types in the packages it touched, lint and unused code (knip) in the files it
# changed, and the tests that import them (vitest related). When main moves
# during the checks it rebases and checks again, and it waits for another
# session's uncommitted edits to files the branch changes rather than touch
# them. --keep leaves the worktree and branch in place after landing. Nothing
# is pushed.
set -euo pipefail

keep=false
if [[ "${1:-}" == "--keep" ]]; then
  keep=true
fi

fail() {
  echo "land: $1" >&2
  exit 1
}

worktree_root=$(git rev-parse --show-toplevel)
main_root=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')
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
[[ "$(git -C "$main_root" branch --show-current)" == "main" ]] ||
  fail "the primary checkout at $main_root is not on main"
# Untracked files count: removing the worktree once it lands deletes them.
uncommitted() {
  git -C "$worktree_root" status --porcelain --ignore-submodules=untracked
}
[[ -z "$(uncommitted)" ]] ||
  fail "commit or drop the worktree's changes first, new files included"

# Main may have moved since the worktree started; commits it already holds
# under other hashes drop out of the rebase.
rebase_onto_main() {
  git rebase --quiet main ||
    fail "rebasing $branch onto main stopped on a conflict; resolve it in $worktree_root, git rebase --continue, then rerun"
}
rebase_onto_main
checked_base=$(git rev-parse main)
changed=$(git diff --name-only main...HEAD)
[[ -n "$changed" ]] || fail "nothing on $branch that main does not already have"
echo "land: $(git rev-list --count main..HEAD) commit(s) on $branch"

# The Commits-to trailers of the commits that wrote the lines this branch
# changes or removes, so a contract one of them made is in view before landing
# rather than found broken by a later review. Shown, never enforced.
node -e '
  const { execFileSync } = require("node:child_process");
  const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });
  const writers = new Set();
  // A renamed file is blamed under the name main has it by.
  for (const entry of git("diff", "--name-status", "--diff-filter=MDR", "main...HEAD").split("\n").filter(Boolean)) {
    const [, file, renamed = file] = entry.split("\t");
    const hunks = git("diff", "-U0", "main...HEAD", "--", file, renamed).matchAll(/^@@ -(\d+)(?:,(\d+))? /gm);
    for (const [, start, count = "1"] of hunks) {
      if (count === "0") continue;
      const blame = git("blame", "--porcelain", "-L", `${start},+${count}`, "main", "--", file);
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
'

# What CI would fail on for what the branch changed. Main moving under a
# landing runs it again, all of it when main changed a file the branch did
# and the types alone otherwise.
check_types() {
  pnpm exec turbo run check:types --filter='[main]' --output-logs errors-only
}
run_checks() {
  # Types across every package the branch touched, since a changed signature
  # breaks callers in files it never opened; lint over the changed files alone,
  # from the root so each resolves its own package config, since what other work
  # left on main is not this branch's to fix.
  check_types
  lintable=$(grep -E '\.(ts|tsx|mjs|cjs|js|jsx)$' <<< "$changed" | while read -r file; do
    [[ -f "$file" ]] && echo "$file"
  done || true)
  if [[ -n "$lintable" ]]; then
    # shellcheck disable=SC2086
    pnpm exec oxlint --type-aware --quiet --no-error-on-unmatched-pattern $lintable
  fi
  # Unused code in what the branch changed, and dependency findings in the
  # manifests of the packages it touched; what other work left unused elsewhere
  # on main is not this branch's to fix.
  pnpm exec knip --reporter json --no-exit-code > "${TMPDIR:-/tmp}/land-knip.json" || true
  CHANGED="$changed" node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const changed = new Set(process.env.CHANGED.split("\n").filter(Boolean));
    const packages = new Set([...changed].map((file) => file.split("/").slice(0, 2).join("/")));
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8") || "{}");
    const found = [];
    for (const issue of report.issues ?? []) {
      const isManifest = path.basename(issue.file) === "package.json";
      const touched = isManifest
        ? packages.has(path.dirname(issue.file)) || changed.has(issue.file)
        : changed.has(issue.file);
      if (!touched) continue;
      for (const [kind, entries] of Object.entries(issue)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          found.push(`${issue.file}: ${kind} ${entry.name ?? JSON.stringify(entry)}`);
        }
      }
    }
    if (found.length > 0) {
      console.error("land: knip finds unused code in what this branch changed:\n" + found.join("\n"));
      process.exit(1);
    }
  ' "${TMPDIR:-/tmp}/land-knip.json"

  # The tests that import a changed source file, run in the package that owns
  # it and in the projects its test:ci runs (Studio's browser project is not).
  for package in apps/studio packages/workspace packages/ai-gateway packages/shared; do
    files=$(grep -E "^$package/.*\.(ts|tsx)$" <<< "$changed" | sed "s#^$package/##" || true)
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
# primary checkout. Those are another session's edits, so wait for it to commit
# them; discarding or stashing them would throw its work away.
wait_for_primary() {
  local waited=0 updates blocking
  while true; do
    updates=$(git diff --name-only main HEAD)
    [[ -n "$updates" ]] || return 0
    # shellcheck disable=SC2086
    blocking=$({
      git -C "$main_root" diff --name-only HEAD -- $updates
      git -C "$main_root" ls-files --others --exclude-standard -- $updates
    } | sort -u)
    [[ -z "$blocking" ]] && return 0
    if ((waited >= ${LAND_WAIT_SECONDS:-600})); then
      fail "another session still has uncommitted edits to files this branch changes, so main was left alone. They are its work: never discard or stash them. Rerun once it commits them:
$blocking"
    fi
    if ((waited == 0)); then
      echo "land: waiting for another session to commit its edits in the primary checkout to:"
      sed 's/^/  /' <<< "$blocking"
    fi
    sleep 15
    waited=$((waited + 15))
  done
}

# Main keeps moving while the checks run, so rebase onto wherever it went and
# check again before fast-forwarding.
for attempt in 1 2 3 4 5 6; do
  wait_for_primary
  git -C "$main_root" merge --ff-only --quiet "$branch" 2> /dev/null && break
  ((attempt < 6)) || fail "main kept moving under the landing; rerun"
  [[ "$(git rev-parse main)" != "$checked_base" ]] || continue
  moved=$(git diff --name-only "$checked_base" main)
  rebase_onto_main
  checked_base=$(git rev-parse main)
  changed=$(git diff --name-only main...HEAD)
  [[ -n "$changed" ]] || fail "main already has everything on $branch"
  if [[ -n "$(comm -12 <(sort <<< "$moved") <(sort <<< "$changed"))" ]]; then
    echo "land: main moved and changed files this branch changes; checking again"
    run_checks
  else
    echo "land: main moved; checking types again"
    check_types
  fi
done
echo "land: main is at $(git -C "$main_root" log -1 --format='%h %s')"

# Fast-forwarding moves the primary checkout's lockfile, not its node_modules.
if grep -qx 'pnpm-lock.yaml' <<< "$changed"; then
  (cd "$main_root" && pnpm install --frozen-lockfile --reporter=silent)
  echo "land: installed the new lockfile in $main_root"
fi

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
  # (registry/), clean or not; the branch is on main by now.
  git worktree remove --force "$worktree_root"
  git branch --quiet -D "$branch"
  echo "land: removed $worktree_root and $branch"
fi
