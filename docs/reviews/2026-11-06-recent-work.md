# Recent work after the 10-31 review

Reviewed: `540309f00ae8f61c29c55c6f405ea08b4a6246dd..820806035fcf85e13962f1ef942e7f8a21f4f025` (334 commits; 1,178 files changed, 73,470 insertions and 44,460 deletions).

The starting point is the last broad review's recorded head. This was a risk-focused review following `REVIEW.md`, covering surviving committed behavior through the pinned head. Three delegated readers reviewed asks and migrations, sandbox and extensions, and transcript and model turns plus feedback privacy; the coordinating reader reviewed drafts and send flows and verified the surviving findings. Existing working-tree edits were excluded. Six Important findings survived verification: one feedback privacy leak, one browser access restriction bypass, two draft preservation defects, one hidden unanswered question, and one interrupted sign-in recovery defect. No Nits are reported.

The main risks are at boundaries between two representations: browser-level versus page-level CDP commands, the composer's live words versus its delayed draft write, synced draft contents versus local tabs, and a completed tool call versus a question still awaiting an answer. The report records focused reproductions and static traces, not an end-to-end app certification.

## Severity

Important means a concrete correctness, security, privacy, or data-preservation defect that should be fixed before shipping. Findings are ordered by consequence; the interrupted sign-in recovery case has the narrowest trigger.

## Findings

### A. Feedback can include a document body that the outline promises to omit

- Status: fixed in `e6d9a770f`
- Severity: Important. Sending ordinary feedback can disclose document content that the default report is intended to exclude.
- Where: [report-outline.ts:356](/packages/workspace/src/lib/report-outline.ts#L356), [report-outline.ts:374](/packages/workspace/src/lib/report-outline.ts#L374), [report-outline.ts:483](/packages/workspace/src/lib/report-outline.ts#L483), [problem-reports.ts:541](/apps/studio/src/electron-main/lib/problem-reports.ts#L541).
- What: the shell parser identifies real heredocs, but `sizeHeredocs` locates their bodies again with a regex over raw command text. An earlier quoted argument containing the same opener and delimiter matches first. The sanitizer consumes that example as the real heredoc, replaces its example body with a character count, then appends the actual heredoc body unchanged. A command that prints a heredoc example before writing a document can therefore send the document's contents in feedback. The AST walker deliberately skips heredoc bodies because it expects this source replacement to handle them, so the long-word rule does not repair the omission.
- Reproduction: use the command below as the `input.command` of a recorded `tool-bash` part, then pass its JSONL record through `outlineSessionLog`.

```bash
printf '%s\n' '<<EOF
example
EOF
'
cat > document.txt <<EOF
PRIVATE_DOCUMENT_BODY
EOF
```

- Verification: a disposable Vitest probe through the complete `outlineSessionLog` path expected the private marker to be absent. It failed: the serialized command replaced `example` with `<7 chars>` and retained `PRIVATE_DOCUMENT_BODY`. The probe was removed. No feedback report was uploaded; the network consequence is traced through the report builder's use of the outline.
- Fix: locate heredocs from parser source positions, or send the whole command as its length when source matching is ambiguous. Cover quoted heredoc examples before a real heredoc with the same delimiter.
- History: introduced by `502d466111`. The [feedback outline decision](/docs/decisions/2026-10-31-feedback-reports-send-an-outline.md) explicitly requires heredoc bodies to go as their length. Its accepted disclosure of short arguments and stderr does not cover a document body missed by the sanitizer. No matching declined review accepts this behavior.

### B. Opening a new tab bypasses the restriction on extension pages

- Status: fixed in `b5a9f2552`
- Severity: Important. An agent can open a password manager's own extension page despite the explicit restriction introduced with extension support.
- Where: [cdp-bridge.ts:769](/packages/workspace/src/logic/server/routes/cdp-bridge.ts#L769), [cdp-task-bridge.ts:349](/packages/workspace/src/logic/server/routes/cdp-task-bridge.ts#L349), [cdp-task-bridge.ts:513](/packages/workspace/src/logic/server/routes/cdp-task-bridge.ts#L513), [cdp-task-bridge.ts:680](/packages/workspace/src/logic/server/routes/cdp-task-bridge.ts#L680).
- What: the new extension check is in `openTargetSession`, but the production browser-level dispatcher intercepts `Target.createTarget` before it gets there. Its `createTarget` checks only local file addresses, asks the window to open the supplied URL, and calls `browser.sendCommand("Page.navigate", { url })` directly. Thus `agent-browser tab new chrome-extension://<installed-extension-id>/app/app.html` can open and hold a password manager's extension tab. Reading a tab already at an extension page remains permitted by design, so the missing creation check defeats the intended restriction rather than merely showing an empty tab.
- Verification: a disposable Vitest probe through the real `handleTaskCdpClient` dispatcher requested an extension URL and expected refusal. It failed: the bridge returned a `targetId`, requested a background tab at that address, and forwarded `Page.enable` and `Page.navigate` with the extension URL. The existing extension test calls the page-session dispatcher directly with `Target.createTarget`, missing production routing. This verifies dispatch and forwarding; no live password vault or Electron extension was opened.
- Fix: apply a shared normalized extension-scheme check in browser-level `createTarget` before `requestWindowTab`, as well as in page navigation. Test through `handleTaskCdpClient`, asserting no tab request or guest navigation happens.
- History: introduced by `cb4da7048`, whose `Commits-to` says an agent never opens an extension page through the bridge. Its explicit acceptance of user-opened extension pages and embedded fill frames remains intact; this finding concerns agent-created tabs. No matching declined review accepts this path.

### C. Switching new-chat drafts can discard the last words typed

- Status: fixed in `8faf38d87`
- Severity: Important. Ordinary navigation within the typing debounce loses unsent user text.
- Where: [new-chat-view.tsx:118](/apps/studio/src/client/components/window/new-chat-view.tsx#L118), [new-chat-box.ts:51](/apps/studio/src/client/drafts/new-chat-box.ts#L51), [prompt-value.ts:129](/apps/studio/src/client/atoms/prompt-value.ts#L129), [prompt-input.tsx:343](/apps/studio/src/client/components/prompt-input.tsx#L343).
- What: type in draft A in the Chat screen, then open draft B or press New before the 300 ms word timer settles. The address effect rebinds the tab's box before flushing A's pending words, then swaps in the destination's text. Both drafts use the same `newChat:<tab-id>` composer key, so the cleanup keyed by `draftKeyed` does not run on this switch. The pending write resolves its target through the current box, not the draft typed into. An editor swap that reports the destination's text replaces the pending write, dropping A's final edit; if no replacement edit is reported, the pending words target the newly bound draft. The saved composer snapshot does not repair the words: the address effect restores `named.words`, using the snapshot only for items.
- Verification: two disposable Vitest probes exercised the real Jotai atoms and timer. After typing `A last words` and binding B, the pending timer wrote those words to B while A remained `A original`. With the destination editor's replacement text reported after binding, both drafts retained their original words and A's final edit disappeared. The editor's replacement transaction reporting its text was traced through `PromptInput.swapIn`, `PromptEditor.replaceDocument`, and `dispatchTransaction`; full screen navigation was not driven in Electron.
- Fix: flush the leaving box's pending words before changing its binding, then restore the destination from the current store. Preserve the stable composer key so making the first draft does not remount the editor. Cover switching to another draft and switching to a blank New screen during the debounce.
- History: introduced by `b5481e1e2`. Its rejection of keying the composer by draft id avoids remounting and losing the caret; flushing before rebinding preserves that decision. No matching declined finding accepts losing pending words.

### D. Showing a draft removes its chosen context from the synced record

- Status: fixed in `3b6363f6f`: the draft's `context` is the record and band tabs a view of it, restoring the contract of `b5f29a5eb`
- Severity: Important. Opening a draft on one computer silently strips the page, app, file, or folder references another computer needs to send that draft correctly.
- Where: [draft-band.ts:98](/apps/studio/src/client/components/window/draft-band.ts#L98), [draft-band.ts:110](/apps/studio/src/client/components/window/draft-band.ts#L110), [window-tabs.ts:44](/apps/studio/src/client/components/window/window-tabs.ts#L44), [draft-record.ts:57](/apps/studio/src/electron-main/drafts/draft-record.ts#L57).
- What: open a draft whose `context` names a web page. `useContextIntoBand` opens the page as a band tab, then removes every non-chat entry from the draft's context. `draftFileOf` writes the resulting context to `DRAFT.md`, while band tabs live only in this computer's kept window layout. After sync, a second desktop receives the words without the page reference, displays no corresponding chip, and sends the draft without that context. The same loss applies to chosen file, folder, and app references. A local view transformation has erased part of the portable draft.
- Verification: a disposable Vitest hook probe supplied a draft with `https://example.com/report`, confirmed the page opener was called, serialized the resulting draft through `draftFileOf`, then reconstructed it with `draftOf` as another computer would. Both the written file and reconstructed draft had `context: undefined`. Actual cross-device filesystem sync was not run.
- Fix: keep a portable representation of the draft's chosen context in `DRAFT.md` while deriving tabs for display. Closing a chip should remove its portable entry explicitly. Avoid a persistence loop where every retained context entry reopens its tab on each render.
- History: introduced by `ef99fea4c`. Its contract that context entries become band tabs determines presentation, but does not require deleting their portable representation. This does not reopen the declined phone-send finding A in `2026-10-27-recent-work.md`: that finding concerned main ignoring still-present context during phone-initiated sends; this regression deletes the context on an ordinary desktop view, so another desktop loses it before sending too.

### E. An unanswered question folds away after an unrelated wake

- Status: fixed in `31c492401`, with the fold made all or nothing; a question is open until its answer is on the call or the person writes past it
- Severity: Important. A question the person still needs to answer can disappear beneath the work summary, making the chat appear finished while it is waiting for input.
- Where: [turns-of.ts:640](/packages/workspace/src/lib/transcript/turns-of.ts#L640), [turns-of.ts:783](/packages/workspace/src/lib/transcript/turns-of.ts#L783), [choose.ts:45](/packages/workspace/src/tools/choose.ts#L45).
- What: `stillAsks` treats every `tool-choose` with `state: "output-available"` as answered. The current tool returns `{ asked: true }` immediately after recording the question, so an unanswered question already has that state. If a child task finishes and wakes the chat, and the chat reports an independent result, the transcript treats the original question as settled and folds it under Worked. Completing the tool call is not the person's answer.
- Verification: a disposable Vitest probe passed an `output-available` unanswered choose call followed by wake/reply messages through `turnsOf`. The question produced `{ open: false, folded: true }` rather than remaining open and outside the fold. The existing open-card test uses the previous `input-available` representation. No running-app fold animation was exercised.
- Fix: inspect the choose output's answer using the existing answer helper, retaining support for earlier answered outputs. Cover an unanswered completed choose call followed by an unrelated task wake and reply.
- History: the transcript rewrite introduced the predicate. `6b0b6518c` explicitly commits to keeping a card outside the fold until the turn records the person's answer. No matching declined review or decision permits this behavior.

### F. An interrupted sign-in can stay waiting after its connection was saved

- Status: fixed in `028c715fd`
- Severity: Important, with a bounded crash or quit trigger. A completed sign-in remains presented as waiting, and its chat does not receive the outcome.
- Where: [drive-asks.ts:940](/packages/workspace/src/lib/chat/drive-asks.ts#L940), [drive-asks.ts:192](/packages/workspace/src/lib/chat/drive-asks.ts#L192), [events.ts:29](/packages/workspace/src/lib/apps/events.ts#L29), [events.ts:57](/packages/workspace/src/lib/apps/events.ts#L57).
- What: the connection can be persisted as connected before the app event has updated and closed its sign-in ask. If the process exits between those steps, the next launch does not reconcile that open ask: `driveOwedAsks` excludes a live open sign-in with no answer, and a regular driver pass refreshes sign-ins only after taking Not now. Normal settlement depends on a new `app.event`, which is not replayed at boot. The stored ask therefore retains its waiting row even though the connection is already connected.
- Verification: a disposable Vitest probe used real ask records and connection storage: record a waiting sign-in ask, persist a connected connection without publishing its event, then run both `driveOwedAsks` and `driveAsks`. The ask remained open, live, and waiting. An explicit `refreshSignIn` immediately closed it. A real OAuth process was not interrupted.
- Fix: reconcile this computer's live open sign-in asks against persisted connections at launch, then settle changed asks. Apply the existing quiet recovery policy so reconciliation does not unexpectedly start an old turn.
- History: introduced by `74a08ee04`. Owner-only sign-in settlement and the quiet wake policy remain valid; recovery needs to read that owner's stored connection. No matching declined review or decision accepts this recovery gap.

## Confirmed tradeoffs

- User-opened extension pages and extension frames embedded in ordinary pages are explicitly accepted by `cb4da7048`; these were not reported as separate access defects.
- A stable new-chat composer key avoids remounting as the first draft is created. Finding C can be fixed without reversing that choice.
- Feedback intentionally includes short command arguments and the end of stderr or tool errors; those accepted fields were not reported as additional privacy defects.
- The project rename preserves the existing folder-grant migration marker and reads the earlier `topic` and permission `topics` shapes. No migration defect was confirmed there.
- Permission cards retry a macOS system wait when mounted, which ruled out a separate suspected prompt recovery defect.

## Not covered

This is not exhaustive coverage of all 334 commits or 1,178 files. Readers concentrated on changed implementation and its callers in asks/answers, sign-ins, project identity and migration, permission aliases, native search and command routing, MXC drive-root handling, extension startup and CDP dispatch, transcript projection/folding, request streaming, repetition and refused-media recovery, feedback outlines and redaction, and draft composition/persistence/send flows. Files selection, cut/paste and drag behavior received a partial static pass only. Broad media playback, image zoom, file-info UI, release and packaging changes, walkthrough tooling, next-message suggestions, updater changes, and visual polish were not comprehensively reviewed. Generated files, registry contents, lockfiles, and version bumps were excluded.

Temporary probes were removed. No product implementation was changed, no full lint/type/unit suite was run, and no native dialogs, live OAuth flows, live password vault, actual multi-device sync, or end-to-end app session was exercised. Findings distinguish the mechanisms reproduced in tests from their statically traced product consequences. Commits and working-tree edits after the pinned head require their own review; the end of this range does not imply exhaustive coverage.
