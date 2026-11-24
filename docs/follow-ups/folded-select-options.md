# Whether agents choose from a closed select's folded options as well as from option lines

**Status:** open · **Check after:** 2026-12-15, or at the next agent-browser upgrade · **Last checked:** never

## What we're waiting to learn

An agent reads the options of a closed select as one line under it (`- N options, chosen with \`select @<ref> <name>\`: "A", "B" [selected], ...`) where agent-browser prints each option on a line with a ref. Two places fold, each in a commit of its own:

- The "Page after" snapshot a call ends with (0d7ef5363), ahead of its 10,000 character cut.
- A `snapshot -i` the agent runs itself, in the bash call's result, wherever the snapshot's text is in the call's output whole (c51e24e99). A pipe, a file and `--json` keep the CLI's text.

The fold itself is `foldSnapshotText` in `packages/workspace/src/lib/shell-commands/agent-browser-snapshot-fold.ts` (63ff68e15). Before it shipped, one small model had read the folded line in three eval trials (`browser-dropdowns-order-form`) and the app had been checked by hand with no model. So the question is open for real chats: does an agent choose an option from that line as readily as from a ref, on the sites people use, and does the line survive an agent-browser upgrade.

## The signal

In a session's records, find the bash calls whose output or attached page has a line matching `options, chosen with \`select @e`, then read the calls after each one, up to the next navigation:

- **A click on, or a `get` of, a ref that the line replaced**, or a call that fails with an unknown ref just after a folded snapshot: the agent wanted an option's ref.
- **A second read made to list the options**: `snapshot -i` piped or redirected and read in part, `snapshot -i --json`, a plain `snapshot`, or an `eval` that reads a select's `options`.
- **A `select` that fails** (`option_not_found` in the output), above all for a name with a quote or a backslash in it: the line prints each name as a JSON string, so a name copied with its backslashes inside single quotes matches nothing.
- **A `select` by name that succeeds as the next step**: the fold working as meant. Count these, since the rate of the three above is only readable against them.
- **A question to the person about which options exist** when the line was in the agent's context.

Separately, at each agent-browser upgrade: the tests under "the installed agent-browser's snapshot of a real page" in `agent-browser-snapshot-fold.test.ts`. They pin the snapshot's text against the installed binary. Failing means the CLI's line format moved; skipping means the machine could not launch a browser, so nothing was checked there. When the format moves in a way the fold cannot read, nothing breaks in the app: every snapshot comes back as the CLI printed it, so no folded line appearing in new sessions is itself the sign.

## Where to look

The primary Mac's workspace records under `.instrument/chats/`, read-only, for chats that used the browser on pages with dropdowns (order and booking forms, filters, settings pages). Eval results for `browser-dropdowns-order-form`, whose evidence lists each agent-browser command. `pnpm --filter @instrument-org/workspace run script:measure-snapshot-fold` reports how many recorded follow-ups change and by how much. The fold tests' output on a developer Mac and in CI, for skipped against passed.

## What each answer means

- **Selects by name succeed and the other signals are rare:** close it; both folds stay.
- **Agents go looking for option refs or re-read to list options after their own `snapshot -i`, but act well on Page after:** revert c51e24e99 alone. The agent's own snapshot then prints every option with its ref, and the attached one stays folded.
- **The same after a Page after snapshot:** revert 0d7ef5363 as well (c51e24e99 first, since it builds on it). 63ff68e15 can stay: with neither caller it is the fold and its tests, used by nothing.
- **`select` fails on names with quotes or backslashes:** keep the folds and change how the line prints a name `select` cannot take as written, or leave such a select unfolded as two options of one name are.
- **Selects fail on one kind of control only** (a custom combobox that keeps its options in the tree while shut, which `select` may not drive): narrow `foldedOptions` to what `select` can choose, with that page's snapshot as a test.
- **The real-binary tests fail after an upgrade:** read the new format into `parseSnapshot` and re-pin; until then the app shows the CLI's text. If they only ever skip in CI, give CI a browser or record that the check is a developer-Mac one.
- **No session had a folded line by the check date:** move the date; dropdowns are rare enough that a month may not show one.

## Result

Not checked yet.
