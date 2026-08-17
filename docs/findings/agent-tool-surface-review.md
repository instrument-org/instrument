# Agent tool surface: gaps against three reference harnesses

**Status:** partly overtaken, not re-audited in full. Recorded against the tool surface as it stood; several items have since been resolved or made moot, so verify any item below against the code before acting on it. Known movement: the atomic `grep` and `glob` tools no longer exist — search moved into the shell on the real ripgrep binary ([2026-07-28](../decisions/2026-07-28-real-ripgrep-in-the-sandbox.md)), which retires sections A4, B1 and B2; `web_fetch` (C1) shipped; and A1, A3, A5 and A6 are fixed in the current tools.

A review of our atomic agent tools (`packages/workspace/src/tools/`) against the built-in tool surfaces of three other coding-agent harnesses: `opencode` (`sst/opencode`), `codex` (OpenAI Codex CLI), and `pi-mono` (`badlogic/pi-mono`). Two of our tools are already adapted from the first and third, so this is partly a check for upstream drift.

The focus is the atomic set -- read, write, edit, glob, grep, bash -- and how it overlaps our just-bash sandbox.

Most of what this review found has since been acted on: the correctness bugs in section A are fixed, and search moved out of the tool surface into the shell (`glob` and `grep` are gone, `rg` is the real ripgrep binary -- see the [decision record](../decisions/2026-07-28-real-ripgrep-in-the-sandbox.md)). What remains open is listed in the shortlist at the end. The comparison itself is kept because it is the reasoning behind those choices, and because the next person weighing a tool against a shell command needs the same map.

## What the three do differently at the top level

|          | tools the model sees                               | file reads                             | edits                                               |
| -------- | -------------------------------------------------- | -------------------------------------- | --------------------------------------------------- |
| **ours** | 7 (was 9)                                          | `read_file`                            | `edit_file` (single old/new)                        |
| opencode | 15-17 (permission-filtered per agent)              | `read`                                 | `edit` or `apply_patch`, swapped by model family    |
| codex    | ~8 core, dozens behind flags                       | **none** -- `cat`/`sed`/`nl` via shell | `apply_patch` only, as a freeform Lark-grammar tool |
| pi-mono  | **4** by default (`read`, `bash`, `edit`, `write`) | `read`                                 | `edit` with an **array** of replacements            |

Two structural observations. Codex deletes the atomic file tools entirely and leans on a curated read-only shell allowlist; pi-mono ships four tools and keeps `grep`/`find`/`ls` registered but inactive unless asked for. Both are evidence that the atomic set is a tuning knob, not a fixed cost -- which matters for us, because our bash sandbox already ships `rg`, `find`, `ls`, and `tree`.

## Where we already lead

Worth stating so these don't get regressed in any cleanup:

- **`read_file` media handling.** Image, PDF, audio, and video with per-type size caps, a pixel-dimension guard, and a supported-format check. opencode does images + PDF; pi-mono images only (though with a much better auto-resize pipeline, see E4); codex has only `view_image`.
- **The virtual FS layout.** `/task` + `/mnt` + `/skills` with one resolver shared by the file tools, the bash interpreter, and the native-binary bridge. None of the three has anything comparable -- all accept arbitrary absolute host paths in every tool.
- **Forced-required `explanation`.** `toolInputSchemaForLLM` advertises it as required in JSON Schema while keeping it optional in Zod, so an omission degrades instead of hard-failing. Nobody else does this.
- **Bash output discipline.** Middle elision (head + tail) with a spill file at `work/tool-output/<partId>.log`. opencode and pi-mono spill but keep only the tail; codex elides the middle but has no spill.
- **Typed tool output.** `outputSchema` + `toModelOutput` cleanly separates what is persisted from what the model reads. opencode only reached this in its unshipped v2 rewrite.

## A. Correctness bugs the comparison surfaced

These are ordered by blast radius. A1-A3 are all in `edit-file.ts` and all involve silent data loss.

**All of section A is fixed.** `edit_file` rejects an empty `oldString` on an existing file, filters block-anchor candidates by size, uses upstream's `0.65` thresholds, and carries the disproportionate-match backstop. `read_file` emits the empty-file note it always advertised, states both of its limits, and lists dotfiles with `/` on directories. A4's grep sort shipped and was then removed along with the tool itself. The rationale below is kept because it explains why those constants and that ordering are what they are.

### A1. `oldString: ""` silently truncates an existing file

`edit-file.ts:758` treats an empty `oldString` as "replace the whole file", so `edit_file({ filePath, oldString: "", newString: "x" })` overwrites the file with `x` and reports `Successfully edited file`. The description never mentions this affordance, so the only models that reach it are the ones that got there by accident -- typically trying to express "insert at the top".

opencode hits the same code path and rejects it with a teaching error, reserving empty-`oldString` for file _creation_ only:

> `oldString cannot be empty when editing an existing file. Provide the exact text to replace, or use write for an intentional full-file replacement.`

Suggested: reject empty `oldString` when the file exists, keep it as the create path when it does not.

### A2. `BlockAnchorReplacer` accepts any single candidate

`edit-file.ts:127`:

```ts
const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0;
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3;
```

Upstream uses `0.65` for **both**. With our value at `0`, a 3+ line `oldString` whose first and last lines happen to match somewhere in the file has its entire middle replaced regardless of how different that middle is -- the similarity score is computed and then compared against zero, so it can never reject. The `0.3` multi-candidate case is also well below upstream.

This is the highest-risk item in the file: it fires on exactly the case where a model half-remembers a block, and the failure mode is a silent wrong edit rather than an error the model can recover from.

### A3. No disproportionate-match guard

Upstream `edit.ts` runs every candidate span through `isDisproportionateMatch` before replacing -- rejecting when the matched span is `>= max(oldLines + 3, oldLines * 2)` lines, or (multi-line needles) more than `max(oldLen + 500, oldLen * 4)` trimmed characters:

> `Refusing replacement because the matched span is much larger than oldString. Re-read the file and provide the full exact oldString for the intended replacement.`

We have no equivalent. Combined with A2 this is the mechanism by which a three-line `oldString` can eat two hundred lines. Adding the guard is cheap and independently useful even if A2 is fixed.

### A4. `grep`'s 100-match cap is applied before the sort it advertises

`lib/grep.ts:100` stops collecting once `matches.length >= limit`, in ripgrep's traversal order. `tools/grep.ts:118` then sorts _those hundred_ by mtime. The tool description says:

> `Returns file paths with line numbers and content, sorted by modification time.`

which a model will reasonably read as "the 100 most recently modified matches". It gets an arbitrary 100 that are then displayed in mtime order. On a large task this systematically hides the files most likely to be relevant.

Fix is either to collect all matches and sort before truncating (costs a `stat` per match, which we already pay), or to stop claiming mtime ordering.

### A5. `read_file` promises an empty-file warning it never emits

The description says:

> `- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.`

For an empty file the code produces `lines = [""]`, `totalLines = 1`, and emits `<content>\n   1→\n</content>`. There is no reminder and no test covering it (`read-file.test.ts` has no empty-file case). The model is told to expect a signal that never arrives, so an empty file is indistinguishable from a one-blank-line file.

Both other repos have the same genre of bug (opencode's `edit.txt` documents error strings the code stopped emitting; its `webfetch.txt` claims an HTTP→HTTPS upgrade that isn't implemented). Worth a general pass over description claims that assert runtime behavior.

### A6. The 50 KB byte cap makes the advertised 2000-line default unreachable

`read-file.ts` sets `DEFAULT_READ_LIMIT = 2000` but `MAX_BYTES = 50 * 1024`. At a typical 35-45 bytes per line of source, the byte cap bites around line 1100-1400, so the documented "reads up to 2000 lines" is wrong for essentially every real source file, and the model gets a `(Use offset parameter...)` footer it did not expect.

The three references all use the same 2000/50 KB pair, so the numbers aren't wrong in isolation -- but opencode and pi-mono both surface _which_ limit fired in the footer text. We do too (`output capped at 50KB`), so this is mostly a description-accuracy issue plus a question of whether 50 KB is still the right number for a product whose agent reads user documents, not just code.

Secondary: the byte-trim loop at `read-file.ts:307-318` re-`join`s and re-measures the whole array on every iteration, so trimming a large file is O(n²) over line count. `truncateHead` in `lib/truncate-buffer.ts` already does this correctly in one pass and is not used here.

### A7. Directory listings hide dotfiles and don't mark directories

`read_file` on a directory calls `listFiles(absolutePath, { limit: 200 })`. `listFiles` defaults `hidden` to falsy, so **every dotfile and dot-directory is silently omitted**, and entries are returned as bare names with no trailing `/`.

So an agent listing the task root cannot see `.env`, cannot tell `output` (a directory) from `output.md` (a file), and gets no signal that anything was hidden. opencode appends `/` to directories and includes dotfiles; pi-mono's `ls` does both and says so in its description:

> `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles.`

## B. Per-tool capability gaps

The individual tweaks, roughly in value order.

### B1. `grep` is missing most of what makes grep useful

Our schema is `{ pattern, path?, include? }`. Compare:

| capability           | ours                 | opencode      | pi-mono              | why it matters                                               |
| -------------------- | -------------------- | ------------- | -------------------- | ------------------------------------------------------------ |
| context lines        | --                   | --            | `context`            | reading a match without a second `read_file`                 |
| case override        | -- (smart-case only) | --            | `ignoreCase`         | smart-case is wrong when the pattern happens to be lowercase |
| literal/fixed-string | --                   | --            | `literal` → `-F`     | models pass `foo(bar)` and get a regex error                 |
| result limit         | -- (hard 100)        | -- (hard 100) | `limit`, default 100 | no way to say "I really do want 400"                         |
| files-only / count   | --                   | --            | --                   | currently requires bash                                      |

pi-mono's `grep` is the best of the three and the cheapest to copy: it also kills the ripgrep child the instant the cap is hit rather than draining and slicing, and its truncation notices name the next move --

> `100 matches limit reached. Use limit=200 for more, or refine pattern`
> `Some lines truncated to 500 chars. Use read tool to see full lines`

-- including routing the model to a _different_ tool from inside a result.

Note the tension with D below: every one of these is already available via `rg` in bash. The question is whether we want `grep` to be a real tool or a convenience shim.

### B2. `glob` has no limit and stats everything before truncating

`GLOB_LIMIT = 100` is hard-coded with no parameter, matching opencode (which also hard-codes 100) but not pi-mono (`limit`, default **1000**, with a `Use limit=2000 for more` notice). 100 is low for a `**/*.ts` on a real project.

`globSortedByMtime` also `stat`s the entire result set before the caller slices to 100 -- on a large tree that is thousands of stats to display a hundred paths. Cheap fix: cap first when the pattern is unsorted, or sort lazily.

Minor: an empty result returns `type: "error-text"`. "No files matched" is a legitimate answer, not an error; opencode and pi-mono both return it as normal text. Marking it an error inflates our error telemetry and may nudge models into retry loops.

### B3. `edit_file` cannot batch

One `oldString`/`newString` per call. pi-mono's `edit` takes an **array**, all matched against the _original_ file, applied in reverse offset order, with overlap detection:

```
edits: Array<{ oldText: string; newText: string }>
```

and prompt guidance that names the failure mode directly:

> `When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls`
> `Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits.`
> `Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.`

Our description instead says "Multiple calls to this tool will be run in serial" -- which is the workaround, not the fix. For a 6-edit refactor this is 6 round-trips and 6 re-reads of the file. This is the single largest latency win available in the atomic set.

pi-mono also ships a `prepareArguments` shim that runs _before_ schema validation and JSON-parses `edits` when a model sends it as a string, with named models in the comment. That pattern -- a per-tool arg-repair hook -- is worth having regardless.

### B4. `edit_file` tells the model nothing about what changed

`toModelOutput` returns `Successfully edited file ${path}` and drops the diff that `execute` already computed. opencode appends LSP diagnostics for the edited file plus up to 5 others; opencode v2 returns a truncated fenced diff preview.

At minimum, returning the changed line number lets a model verify placement without a re-read. See C5 for the diagnostics version.

### B5. `write_file` has no read-before-write and no staleness check

The description asserts:

> `If this is an existing file, you MUST use the ${ReadFile.name} tool first to read the file's contents before writing.`

Nothing enforces it, and nothing compares the file's mtime against the one `read_file` returned. opencode v1 and pi-mono are in the same position (opencode even ships the stronger bluff "This tool will fail if you did not read the file first", with no implementation).

But **our exposure is worse than theirs**, because users edit task files directly while the agent works. There is no longer any detection of that: the between-turn diff was deleted with the standing file index, on the grounds that it could only ever see the task directory and the work is moving into folders the user picks. A user editing `output/report.md` mid-turn loses the edit with no signal to either party.

opencode's v2 rewrite is the only one that solved it, with optimistic concurrency on write:

> `File changed after permission approval. Read it again before editing.`

We already return `modifiedAt` from `read_file` and `edit_file`; the missing piece is a per-session read-time map and a comparison at write time. This is the highest-value _new_ safety mechanism in this document.

### B6. `bash`: 30s default timeout, and no backgrounding

`DEFAULT_TIMEOUT_MS = ms("30 seconds")`. Compare: opencode 2 minutes (no max), codex 10s for one-shot `shell_command` but **no timeout at all** for its session-persistent `exec_command`, pi-mono no default (runs forever).

30s is below the runtime of `pnpm install`, a `tsc` pass on a real project, an ffmpeg transcode, or a `uv` first-run Python download -- all things our agent does routinely. The model can raise `timeoutMs`, but only after eating a failure and a retry, and the description doesn't tell it what a realistic value is.

Backgrounding is documented as unsupported ("Backgrounding is NOT supported. Each call must complete within `timeoutMs`"), which is a hard ceiling on dev servers and long builds. Codex's design is the interesting one here: allocate a session id, return `Process running with session ID {n}`, and expose a `write_stdin` that with empty `chars` acts as a pure poll -- with a deliberate asymmetry where writes clamp to 250ms-30s and empty polls to 5s-5min. That is a much bigger change than a timeout bump, but it is the shape to copy if we want `pnpm dev` to be reachable.

Smaller: both opencode and codex expose a `workdir` parameter and tell the model not to use `cd`. Codex additionally keeps the _sandbox policy_ cwd pinned to the environment root even when `workdir` moves the command, so changing directory never widens the writable root -- which fits our mount model well.

### B7. Small `read_file` items

- **Strip a leading `@` from paths.** pi-mono does this in its shared path resolver with the comment that some models include the `@` prefix from file-mention syntax. We already do the harder Unicode-fallback work adapted from the same file; this is two lines.
- **Directory listings are not recursive and cap at 200.** `tree` exists in bash, so this may be fine -- but see D.

## C. Tools we don't have

### C1. `web_fetch` -- the strongest missing tool

We have no way to turn a URL into readable text. The agent has `curl` in bash, but:

- `html-to-markdown` is in `BROKEN_COMMANDS` (undeclared peer dep), so it isn't registered at all -- not even stubbed with an explanatory message like `npm` and `sqlite3` get. A model that runs it gets `command not found`.
- So converting a page to markdown means writing and running a script, or driving `agent-browser`, for what is a one-line operation elsewhere.

This directly undercuts guidance we already ship in the main prompt:

> `Results are a search model's summary, not the source. Search again or read the page when results conflict, when a cited source looks like it does not support the claim, or when the answer turns on one specific fact.`

There is no good "read the page" affordance behind that sentence. opencode's `webfetch` is a reasonable template: `{ url, format: "text"|"markdown"|"html", timeout? }`, Turndown for HTML→markdown, 5 MB cap, 120s max timeout, images returned as attachments, and a genuinely useful detail -- a retry with an honest `User-Agent` when Cloudflare returns 403 with `cf-mitigated: challenge`.

Cheapest version: fix or replace `html-to-markdown` in the sandbox. Better version: a real tool, so the size cap, timeout, and SSRF policy are enforced in one place rather than per-script.

### C2. A todo / plan tool

We have none. opencode has `todowrite`, codex has `update_plan`, pi-mono ships one as an example extension. All three converged on the same schema shape (a list of `{ text, status }` with at most one `in_progress`) and on prompt rules that are mostly about _discipline_:

> `Maintain statuses in the tool: exactly one item in_progress at a time... Do not jump an item from pending to completed: always set it to in_progress first. Do not batch-complete multiple items after the fact.`
> `Skip using the planning tool for straightforward tasks (roughly the easiest 25%). Do not make single-step plans.`
> `Mark completed only after the required work is actually done, including any required verification. Never based on intent.`

Two arguments for us specifically: our main prompt already asks the agent to "stay with the task until it is handled end to end", which is exactly the behavior a plan tool reinforces; and it is a _UI_ affordance in a chat product, not just model steering -- users watching a long task get progress they can read.

Note codex's counter-position: `update_plan` is rejected outright in plan mode and its prompt tells the model to skip it for the easiest 25% of tasks. A todo tool that fires on every trivial request is worse than none.

### C3. A structured question tool (`choose` is a stub)

`choose` exists in `TOOLS`, has a reasonable schema, `execute`s to `executeError("Not implemented")`, and is not in the main agent's tool list. It is half-built rather than dead, but as it stands it is registry weight with no behavior.

Meanwhile the main prompt tells the agent to ask questions in prose:

> `Ask a question only when the answer cannot be discovered and a wrong assumption would materially change the result...`

Both opencode (`question`) and codex (`request_user_input`) ship this as a real tool, and their descriptions have converged on the same two non-obvious rules:

> `If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`
> `Do not include an "Other" option in this list; the client will add a free-form "Other" option automatically.`

opencode also deliberately hides the `custom` field from the model-facing schema while keeping it internally, and disables the whole tool for non-interactive clients. Either finish `choose` against that shape or delete it.

### C4. A subagent tool (plumbing exists, unused)

`SpawnAgentFunction` is defined in `lib/spawn-agent.ts` and threaded through `AgentTool.execute`'s options, but **no tool calls it** -- the only references outside the type are `vi.fn()` in tests. That is live plumbing for a feature that doesn't exist.

Both opencode (`task`) and codex (multi-agent V1/V2) ship this, and both wrote their descriptions primarily as _guards against overuse_:

> `If you want to read a specific file path, use the Read or Glob tool instead of the Task tool, to find the match more quickly`
> `Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work. Requests for depth, thoroughness, research, investigation, or detailed codebase analysis do not count as permission to spawn.`

Worth deciding explicitly: either build it or remove the parameter. Carrying unused capability in the tool context makes every tool signature imply something untrue.

### C5. Diagnostics feedback after edit/write (bigger bet)

opencode appends LSP errors to `edit`, `write`, and `apply_patch` results -- severity-1 only, max 20 per file, `SEVERITY [line:col] message`, plus up to 5 other affected files:

```
LSP errors detected in this file, please fix:
<diagnostics file="/abs/path">
ERROR [12:5] message
... and 3 more
</diagnostics>
```

We have `tsc` in bash and the main prompt asks the agent to run it, which means the feedback loop is opt-in and usually skipped. A cheaper first version than full LSP: after an edit to a `.ts`/`.tsx` file inside `work/`, run the existing `tsc` path and append errors _for that file only_. The risk is latency on every edit, so it likely wants to be conditional or debounced.

## D. Overlap with bash: what could be removed or re-routed

The bash sandbox ships, among others: `rg`, `find`, `ls`, `tree`, `cat`, `head`, `tail`, `sed`, `awk`, `jq`, `yq`, `xan`, `diff`, `stat`, `file`, `wc`, `curl`. So every read/search tool we have is duplicated by something more capable in the shell. Three coherent positions exist, and all three references pick one:

**1. Delete the search tools, keep the shell (codex).** No `read`/`grep`/`glob` at all; the model uses `rg`, `sed -n`, `nl`, `ls`, and the safety story is a curated read-only auto-approve allowlist with per-command flag denylists (`find` minus `-exec/-delete/-fls`, `rg` minus `--pre/-z/--search-zip`, `sed` only in `sed -n N,Mp` form, `git` limited to `status log diff show branch`). Their prompt then just says:

> ``When searching for text or files, prefer using `rg` or `rg --files` respectively because `rg` is much faster than alternatives like `grep`.``

**2. Keep the tools and forbid the shell equivalents (opencode).** Their shell description carries an explicit routing table:

> `File search: Use Glob (NOT find or ls)` / `Content search: Use Grep (NOT grep or rg)` / `Read files: Use Read (NOT cat/head/tail)` / `Edit files: Use Edit (NOT sed/awk)` / `Write files: Use Write (NOT echo >/cat <<EOF)`

Worth knowing that this _contradicts_ their own `grep.txt`, which says to use `rg` in bash for counting matches. Two prompt files, opposite instructions, shipping simultaneously. That is the failure mode of position 2.

**3. Ship both, and let the active tool set decide the prompt (pi-mono).** Their system prompt emits the bullet `Use bash for file operations like ls, rg, find` **only when bash is active and none of `grep`/`find`/`ls` are**. Turn on the `grep` tool and the bullet disappears. The prompt is generated from the active tool set and rebuilt whenever it changes, so it can never tell the model to shell out for something it has a first-class tool for.

**What we did: removed both search tools and moved search into the shell.**

`glob` went first. Across 718 local task databases it accounted for 126 calls (2.6% of all tool calls, 17 in the last 30 days), 38% of which were `**/*` or `*` -- a directory listing rather than a search -- and 20% of which returned nothing, while bash `ls` (162) and `find` (43) already outnumbered it.

`grep` followed once bash's `rg` became the real ripgrep binary, because at that point the tool was spawning the same binary through a narrower interface, at the cost of a tool call whose result could not be piped anywhere. Both removals were checked against real models rather than assumed: with each tool gone, Haiku 4.5 and Sonnet 5 both reached for `find` and `rg` in the shell unprompted, used context flags without being told they existed, and answered correctly.

That lands us at **position 1** -- codex's -- for search specifically, while keeping the atomic file tools that shell commands cannot replace: `read_file` returns images, PDFs, audio, and video as media parts, which `cat` cannot do.

The routing guidance is now the thing to keep honest. There is exactly one way to search, and the bash description says so; the failure mode to watch for is the opencode one, where two prompt files drift into contradicting each other.

**Where the remaining tools sit.** The bash description tells the model to prefer `read_file` over `cat`/`head`/`tail` and `edit_file`/`write_file` over `sed`/`awk`/redirects. Those are the routing claims still worth auditing: the usage data shows the model ran `head` 254 times and `cat` 51 times anyway, which is real evidence that a prompt line alone does not move behavior much.

How each tool was judged, which is the reusable part:

- **`glob` went.** Hard-capped at 100, no limit parameter, and fully expressible as `rg --files --glob=...`. Its mtime sort was the only thing it added, and 38% of its real usage was a directory listing rather than a search.
- **`grep` went** once bash's `rg` was the same binary. The argument that kept it for a while -- structured output for the UI, and `/mnt` host-path rewriting -- survived only until the shell could do the second one too. What removing it costs is the rendered result card; what it buys is one search path with the full flag set, and no tool call per search.
- **`read_file` stays.** It is the only path to images, PDFs, audio, and video, and `cat` cannot return media parts. Its directory mode was fixed (A7) rather than routed to bash, since it is the natural landing place when a model reads a path that turns out to be a folder.
- **`edit_file` stays**, and is the subject of its own open question (B3, and the `apply_patch` plan).

The general test that fell out of this: a tool earns its slot when it does something the shell cannot (media parts), or when its structured result is worth a round trip. Being a more convenient spelling of a shell command is not enough.

## E. Cross-cutting patterns worth adopting

### E1. Every truncation footer should name the next action

pi-mono is the most disciplined here. Not `[truncated]` but:

> `[Showing lines 1-2000 of 8134. Use offset=2001 to continue.]`
> `[Line 1 is 2.3MB, exceeds 50.0KB limit. Use bash: sed -n '1p' path/to/file | head -c 51200]`
> `100 matches limit reached. Use limit=200 for more, or refine pattern`

Note the second one routes to a _different tool_ with a complete command, and the third suggests the doubled value rather than saying "use a larger limit".

opencode goes further and varies the hint by capability -- when the agent has the `task` permission, its truncation message becomes a delegation instruction instead of a paging one.

Ours are decent (`Use offset parameter to read beyond line N`, `Consider using a more specific path or pattern`) but the grep/glob ones don't name a parameter because no parameter exists (B1, B2).

### E2. Error strings should name the fix

Because a thrown error becomes the tool result text verbatim in all three harnesses, their messages are written as instructions. A sample of the best:

> `Found 4 occurrences of edits[2] in <path>. Each oldText must be unique. Please provide more context to make it unique.`
> `edits[0] and edits[1] overlap in <path>. Merge them into one edit or target disjoint regions.`
> `stdin is closed for this session; rerun exec_command with tty=true to keep stdin open`
> `patch detected without explicit call to apply_patch. Rerun as ["apply_patch", "<patch>"]`

pi-mono's are singular/plural aware so they never read as boilerplate. Ours are mostly fine (`Path escapes the task directory`, the read-only mount message with its `cp` example) but `edit_file`'s are terser than they should be given how often models hit them.

### E3. Fuzzy matching should be visible

We run ten fallback replacers. Codex runs four passes and pi-mono two, and **none of the three tells the model when a fuzzy match fired**. Codex's report calls this out as their own known gap.

Our exposure is the largest of the four, because we have the most fallbacks and (per A2) the loosest thresholds. A one-line note in the success output -- "matched after whitespace normalization" -- costs nothing and lets a model notice when its mental model of the file has drifted.

Related, pi-mono solves a problem we have: when a fuzzy match succeeds, writing the _normalized_ buffer back would silently rewrite the whole file (stripping trailing whitespace, replacing every em-dash). They widen each replacement to the lines it touches and copy every untouched line byte-for-byte from the original. Our `UnicodeNormalizedReplacer` yields a slice of the original rather than the normalized text, so we mostly avoid this -- but it's worth a test.

### E4. Image handling hints

pi-mono's auto-resize emits a coordinate-mapping hint the model can act on:

> `[Image: original 4000x3000, displayed at 2000x1500. Multiply coordinates by 2.00 to map to original image.]`

and degrades rather than failing -- resize, try PNG and JPEG, take the smaller, drop JPEG quality, shrink dimensions. We currently hard-error above 8000px with `Please resize the image before reading`, which sends the agent on a bash/ffmpeg detour for something we could do inline. They also sniff format by magic bytes rather than extension, and reject APNG and lossless JPEG explicitly.

### E5. We execute every tool call serially, while telling the model to batch

`machines/agent.ts:437-460` pushes every non-interactive tool call onto `toolCallQueue`, and the queue is drained one at a time (`const [nextToolCall] = context.toolCallQueue`). **No two tool calls ever run concurrently**, including independent reads.

Meanwhile three separate places tell the model that batching pays off:

- `read_file`: _"It is always better to speculatively read multiple files as a batch that are potentially useful."_
- `edit_file`: _"Using this tool multiple times in parallel will still greatly improve efficiency and reduce costs."_
- the main prompt: _"Batch or parallelize independent tool calls when useful."_

Batching does still save assistant turns, which is real. But the `edit_file` line as written promises a speedup that cannot occur, and for read-heavy exploration -- ten `read_file` calls, each with a 15s timeout -- the serial drain is a straightforward latency cost we are choosing.

We are the only one of the four harnesses that does this. pi-mono runs tools **parallel by default** with a per-tool `executionMode: "sequential"` opt-out (and one sequential tool forces the whole batch sequential), and gets write correctness from a per-file mutation queue keyed by `realpath()` instead. opencode uses a per-path `Semaphore(1)` around edits for the same reason. Codex enables `parallel_tool_calls` and tells the model explicitly:

> ``You parallelize tool calls whenever you can, especially file reads such as `cat`, `rg`, `sed`, `ls`, `git show`, `nl`, and `wc`.``

The tradeoff is real -- serial execution is why we have never needed a mutation queue, and it makes tool-call ordering deterministic for replay. But the choice should be deliberate. The middle path is what pi-mono ships: parallelize `readOnly` tools (we already have that flag on every tool), keep writes serial, and fix the descriptions either way.

## What is still open

Everything in section A is fixed, and the search tools are gone. What is left, with the decided-against items recorded so they are not re-proposed:

**Open**

1. **B3** -- batched `edit_file`. The largest remaining latency win: a six-edit refactor is six round trips. Contested by the `apply_patch` plan; note that opencode ships `apply_patch` only to GPT-family models and pi-mono skips it for exactly this array-of-edits shape.
2. **C2, C3, C4** -- todo, structured question, subagent. Product decisions more than tooling ones. `choose` (a stub that is registered but returns "not implemented") and `spawnAgent` (threaded through every tool's context and called by nothing) should at least stop being half-present either way.
3. **C5** -- diagnostics after an edit. We have `tsc` in the sandbox and a prompt asking the agent to run it, which makes the feedback loop opt-in and usually skipped.
4. **E1-E4** -- the cross-cutting prompt patterns: actionable truncation footers, errors that name the fix, telling the model when a fuzzy edit match fired, and pi-mono's image-resize hints.

**Closed by other work**

- **C1** (`web_fetch`) -- the `jmack/web-tools-exa` branch adds the tool.
- **B6** (bash timeout, backgrounding) -- the `spike/background-shell` branch replaces the timeout with a yield-and-promote model plus `bash_output` and `bash_kill`, which is close to codex's `exec_command`/`write_stdin` design.
- **B1, B2** -- moot; both tools are gone and `rg` has the full flag set.

**Decided against**

- **B5** (read-before-write staleness) -- agents do not reliably re-read in practice, so the check would mostly fire on writes that were fine.
- **E5** (parallel tool execution) -- serial execution is deliberate, for consistent ordering and replay. The prompt language about batching is about fewer assistant turns, not concurrent execution, and is accurate as written.
