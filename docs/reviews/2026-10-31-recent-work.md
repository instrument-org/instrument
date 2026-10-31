# Recent work after the 10-28 review

Reviewed: `dedc15400..540309f00` (232 commits; 806 files changed, 44,903 insertions and 18,005 deletions), less the thirteen Windows Velopack updater commits `2026-10-30-windows-velopack-updater.md` already read.

Five blind readers took one area each, following `REVIEW.md`: the capability registry, the script channel and the Mac's own apps as bundled MCP apps; permission and question cards answered from any device and the one wake queue; workspace reads moved off the main thread and evicted cloud files; the AI gateway's Responses stream guard, Claude account turns, the rewritten agent tools and the feedback report; and Studio's idle restart, release notes, Files addresses, workspaces in Settings and the packaging prunes. Every finding below was re-read at `540309f00` by the reviewer who wrote this file and checked against `docs/decisions/`, the declined findings here, and the trailers of the commits that introduced it. A, C and D turn on a link the agent planted itself, which `threat-model.md` counts as in scope ("a link the agent planted itself is not a race"); A predates the range and is reported because the range opened the same read to scripts and tasks.

## Findings

### A. `memory show` reads any file a link in `Memory/` points at, and `memory save` writes through a linked `Memory/`, from the app process

- Status: open
- Where: [store.ts:221](/packages/workspace/src/lib/memory/store.ts#L221), [store.ts:147](/packages/workspace/src/lib/memory/store.ts#L147), [memory.ts](/packages/workspace/src/lib/capabilities/memory.ts)
- What: `readMemoryFile` reads with `fs.readFile` and `fs.stat`, both following links, and `memoryDir()` is never resolved. A chat that may write `Memory/` runs `ln -s ~/.ssh/id_ed25519 Memory/k.md`, then `instrument memory show k` (or `instrument.memory.show("k")` from a script) prints the key, read outside the sandbox that refuses `~/.ssh`. Replacing `Memory/` with a link to a refused folder makes `memory save notes …` overwrite `notes.md` there. The listing is safe (`isFile()` on the dirent), so the link only works by name.
- Verification: probe by the reader against `readMemory` and `saveMemory` with `Memory` linked to a refused folder (`PROBE read: "secret text"`, then the refused folder's `notes.md` overwritten); the reviewer traced the reads statically.
- Fix: refuse a `memoryDir` whose real path is not itself, and `lstat` each entry, refusing anything but a regular file, before reading or rewriting it.
- History: the read dates from `255a292a9` (2026-09-19); `5d7ff3d5b` opened `memory.show` to scripts and tasks.

### B. The agent's write-up in a feedback report is sent without redaction

- Status: open
- Where: [feedback-dialog.tsx:74](/apps/studio/src/client/components/studio-modals/feedback-dialog.tsx#L74), [problems.ts:128](/apps/studio/src/electron-main/rpc/routes/problems.ts#L128), [problem-reports.ts:732](/apps/studio/src/electron-main/lib/problem-reports.ts#L732)
- What: every other item in a report comes from `describeFeedback`, which runs `reportRedactor` in main so that "what Show details shows is what is sent". The write-up is built in the renderer by `writeupItem` and `sendFeedback` passes it, and the report `title`, straight to `sendReport`. `offer_feedback` tells the agent to quote errors verbatim, so a home-folder path, an email, another chat's id or a key in that error goes out as written, while the same text in the attached chat is redacted. The model-error report (`1622ef2ac`) puts a failed tool input, such as a `write_file` of a `.env`, in the same place.
- Verification: traced statically; found independently by two readers.
- Note: outside the threat model, since the agent quotes what it could already read and the person sees the text before it goes; reported under `REVIEW.md`'s privacy rule, as the one item a report sends unredacted.
- Fix: hand the write-up and title to main and redact them there, as an item `describeFeedback` returns, so the dialog shows the redacted text.
- History: `38ab1f9ba`, widened by `1622ef2ac`; `95ed9bfa8` added chat-id redaction everywhere but here.

### C. A file handed to Mail is checked once, and Mail reads whatever the path leads to later

- Status: open
- Where: [context.ts:62](/packages/workspace/src/lib/capabilities/context.ts#L62), [mac-app.ts:45](/packages/workspace/src/lib/apps/mac-app.ts#L45), [apps.ts:436](/packages/workspace/src/lib/capabilities/apps.ts#L436)
- What: `readableFile` holds the path to the folder rules, where a link leads included, and returns the path; Mail's fixed script reads it afterwards, outside every sandbox. A background loop of the agent's own that swaps `a.txt` between a link to an allowed file and one to `~/.ssh/id_ed25519` passes the check and has Mail attach the key.
- Verification: traced statically; Mail was not driven.
- Fix: after the check, copy the file (opened without following links) into a folder the app owns, and hand Mail the copy.
- History: `b426dd164` moved the check into `readableFile`; the old `mail` command had the same check-then-use shape.

### D. A link at a venv's `site-packages` has the app write `_instrument.pth` into a refused folder

- Status: open
- Where: [python-runtime.ts:428](/packages/workspace/src/lib/capabilities/python-runtime.ts#L428), [runtime-file.ts:30](/packages/workspace/src/lib/capabilities/runtime-file.ts#L30), `linkPythonBase` in `python-base.ts`
- What: `replaceFileIn` replaces a link at the file name, but its `writeFile(tmp, wx)` and `rename` follow a link at the folder. A chat that makes its `.venv/lib/python3.x/site-packages` a link to a Not allowed folder and runs `python x.py` gets the app, outside the sandbox, to create or replace `_instrument.pth` there. The content is fixed, so the harm is a write into a folder the person closed.
- Verification: probe by the reader, the `linkPythonRuntime` test with `site-packages` linked to a temp folder: the file landed there.
- Fix: write only when `realpath(site-packages)` is inside `realpath(venv)` and the rules allow writing it.
- History: `7037b4c53`; `4a890f816` names this gap in its body ("A link at `site-packages` itself … can still redirect the fixed `.pth` write") with no `Rejected:` trailer or decision record.

### E. Removing the installed download at launch reads a stable arm64 Mac zip's version as a prerelease and deletes it on a beta

- Status: fixed `9b5452b5d`
- Where: [updater-cache.ts:55](/apps/studio/src/electron-main/lib/updater-cache.ts#L55)
- What: the Mac target sets no `artifactName`, so its zip keeps electron-builder's `Instrument-2.0.0-arm64-mac.zip`, and the optional prerelease group takes `-arm64`. `2.0.0-arm64` sorts below `2.0.0-beta.119`, so on an arm64 beta a 2.0.0 download that never installed (the app quit before Squirrel finished) is deleted at the next launch and fetched again. An x64 zip reads as newer and is kept.
- Verification: run by the reviewer with the same regex and `semver`: `Instrument-2.0.0-arm64-mac.zip 2.0.0-arm64 removed: true`.
- Fix: read the version from the feed file in `pending/`, or strip a known arch suffix before parsing.
- History: `d03280af0`.

### F. While a restart waits on a newer download, the no-window clock goes stale and can restart right after the window was used

- Status: fixed `c425a6a41`
- Where: [idle-restart.ts:203](/apps/studio/src/electron-main/lib/idle-restart.ts#L203), [idle-restart.ts:61](/apps/studio/src/electron-main/lib/idle-restart.ts#L61), [idle-restart-policy.ts:123](/apps/studio/src/electron-main/lib/idle-restart-policy.ts#L123)
- What: once `restarting` is set, `tick` returns early for up to the three-minute superseding-download wait, so nothing samples the window; the focus handler clears only `quietSince`. Open the window, use it, minimize it, and the `confirm` reading sees `shown: false` with the old `noWindowSince` and restarts at once. Work, focus and the lock are re-read, so nothing running is cut off.
- Verification: traced statically.
- Fix: clear `noWindowSince` on focus, show and restore, or keep sampling while `restarting`.
- History: `6adcbd7c3`, kept by `e282a8164`.

### G. One card's answer waits on, and fails with, another card acted on in the same pass

- Status: fixed `b65c514cf`
- Where: `card-answers.ts:105` at 417c95c1f, `card-answers.ts:166` at 417c95c1f
- What: `answerAsk` awaits `takeCardAnswers`, which awaits every card that pass took, before waiting on its own. When another device's answer to card X lands in the same pass as the person's Allow on Y, or under `declineAll`, Y's call waits on X's macOS prompt, and fails with X's error after Y was granted and closed, so the card that worked shows "Couldn't…".
- Verification: traced statically.
- Fix: start the pass without awaiting the other cards and await only `acting.get(actingKey(chatId, askId))`.
- History: `400848f41`, `d911acdd6`.

### H. A declined card can close without waking the session that asked

- Status: fixed `b65c514cf`
- Where: `card-answers.ts:275` at 417c95c1f, `card-answers.ts:129` at 417c95c1f
- What: `decline` runs `closeAsk`, then `setDenied`, then `wakeAskers`. If `setDenied` throws (an unwritable `permissions.json`) or the app quits between them, the card is closed on every device, `failAnswer` skips it as closed, and `isDue` re-acts only on open cards, so the asker waits for good. `d911acdd6`'s recovery covers a crash before the close only.
- Verification: traced statically.
- Fix: write the refusal and the wake before closing, or mark on the card that its askers were woken and re-act on a closed card without the mark.
- History: the close-then-wake order predates the range; `d911acdd6` added the recovery that misses it.

### I. A failed read of another device's synced store file is marked seen, so its entries stay missing

- Status: fixed `51a3a4546`
- Where: [synced-store.ts:166](/packages/workspace/src/lib/synced-store/synced-store.ts#L166), [synced-store.ts:345](/packages/workspace/src/lib/synced-store/synced-store.ts#L345)
- What: `lookOnce` records the file's size and mtime before reading it, and `readIfThere` turns any error into an empty buffer. An evicted file whose download fails offline, or an `EBUSY` from a sync client on Windows, leaves that device's bookmarks missing until it writes again. `activity/store.ts` skips recording on a failed read.
- Verification: traced statically.
- Fix: record `seen` only after a read that succeeded, letting the error reach `lookOnce`.
- History: the order predates the range; `8be74f5c7` rewrote these lines and made a failed download likelier.

### J. A moment's lock on `workspace.json` skips a launch's chat folders

- Status: fixed `96b78f3a1`
- Where: [convert-chat-records.ts:204](/apps/studio/src/electron-main/lib/convert-chat-records.ts#L204)
- What: `markConverted` reads `workspace.json` before its `try`, and since `c4dfcd295` that read throws on any error but a missing file, so a sync client or antivirus holding the file on Windows sends the error out of `convertChatRecords`, and that launch skips `writeConvertedChatFolders` and its notice.
- Verification: traced statically.

### K. With the original `CHAT.md` evicted, a duplicated chat folder is recorded as the chat's own

- Status: fixed `0e7146a7d`
- Where: [record-folders.ts:247](/packages/workspace/src/lib/record-folders.ts#L247), [own-folder.ts:76](/packages/workspace/src/lib/chat-folders/own-folder.ts#L76)
- What: the sync scan passes over a `CHAT.md` kept by name only, so with the person's copy of a chat's folder beside an evicted original it sees one folder naming the chat, and `chatOwnFolder` records the copy for good, where reading both would have found two and recorded nothing.
- Verification: traced statically.
- History: `0e2063521`.

### L. A retry the client aborted is reported as a failed retry

- Status: fixed `02b8b36f0`
- Where: [responses-stream-guard.ts:137](/packages/ai-gateway/src/lib/providers/responses-stream-guard.ts#L137)
- What: the catch around the retry's `send()` reports `retry: "failed"` without checking `signal.aborted`, so a person's Stop during the retry reaches error tracking as a failure.
- Verification: traced statically.
- History: `45d3c2ef1`.

### M. The threat model says the Mac's own apps are allowed per chat, on a card or in Settings

- Status: fixed `a8eb32da6`
- Where: [threat-model.md:21](/docs/architecture/threat-model.md#L21)
- What: since `b426dd164` each is connected once in Apps for every chat, as `agent-sandbox.md` says.

## Checked and found sound

- The Responses stream guard retries only before anything past the lifecycle events reached the client, so nothing is delivered twice; event framing holds `\r\n` across chunks, and an abort cancels upstream while held and while relaying.
- Usage limit and throttling are told apart by the refusal's code; a Claude account turn stopping on throttling Claude Code already retried is deliberate.
- A card's taken answer wins over a later log's "first" answer, spent answers are matched on one device's own clock, and a Stop from another device is written into the card before any wake.
- The script channel token stays out of child processes' environments on macOS and Linux; a task is refused setup, memory writes and `window` on every surface, scripts included.
- No read error found that writes a default over the real file: app files, kept window state and `workspace.json` all refuse on an unreadable read.
- The idle restart is bounded to two attempts per target and an hour apart, across launches, and re-reads running work before quitting.
- The packaging prunes keep what main requires at runtime, and `verifyGitSurvived` guards the git relink.

## Not covered

The thirteen Velopack commits (reviewed 10-30), docs-only commits, evals, and the wireframe kit. The rewritten agent tools were read as `git diff -w` for regressions only.
