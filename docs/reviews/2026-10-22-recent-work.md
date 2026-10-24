# Recent unreviewed work

Reviewed: `ad7868f11..65ba30fde` (206 commits; 704 files changed, 40,361 insertions and 8,715 deletions).

The starting point is the previous review's recorded head. This was a risk-focused review of surviving behavior at `65ba30fde`, following `REVIEW.md`: draft format compatibility, workspace placement and recovery, API and MCP credentials, agent request assembly, image routing, dictation streaming, and permission handling. Three Important findings survived verification, all reproduced with temporary unit probes. No Nits are reported. This is not exhaustive coverage of every changed file; the remaining limits are below.

## Findings

### A. Existing DRAFT.md attachments disappear after the context-line format change

- Status: not a defect
- Note: the `attached` DRAFT.md shape (`5b2df3325`, 10-15) and its replacement (`ea8215268`, 10-21) both first shipped in v2.0.0-beta.100, so no release wrote the shape this reads. The release before, v2.0.0-beta.61, kept drafts in the hidden folders `migrate.ts` turns into `context` lines. Rechecked in `2026-10-24-recent-work`.
- Where: [draft-file.ts:124](/packages/workspace/src/lib/drafts/draft-file.ts#L124), [draft-record.ts:73](/apps/studio/src/electron-main/drafts/draft-record.ts#L73)
- What: a draft the base revision wrote with `attached: [{ kind: file, path: pasted.png }]` is read with no `context`. The old attachment list is kept only as unrecognized front matter in `others`; the composer rebuilds its attachments solely from `draft.context`. Opening the existing draft therefore shows no attachment, and sending its words omits the file. The file can remain beside the draft, but the app has lost its association with the message. This is Important because an upgrade silently changes what a person's unsent message sends.
- Verification: a temporary Vitest probe parsed a base-format DRAFT.md and expected `context: ["pasted.png"]`; actual output was `undefined`. A second probe confirmed an attachment-only draft now satisfies `isEmptyDraft`, returning `true`. The composer consequence was traced statically through `draftOf`; it was not exercised in the running app.
- Fix: read the previous `attached` and selected-context representation into the new context lines when `context` is absent, or migrate existing visible drafts before opening them. `migrateDraftsToFolder` handles the older hidden draft folders, not this already-visible DRAFT.md shape. Cover a pasted attachment, an absolute attachment, and the selected context the previous writer persisted.
- History: introduced by `ea8215268`. Its choice to persist context as lines does not require dropping the previous writer's attachments. No declined finding accepts this compatibility break.

### B. An API token refresh ignores cancellation and the request deadline

- Status: fixed `464106122`
- Where: [api-oauth.ts:206](/packages/workspace/src/lib/apps/api-oauth.ts#L206), [api-oauth.ts:249](/packages/workspace/src/lib/apps/api-oauth.ts#L249)
- What: after the service returns 401, `performSignedInRequest` awaits `apiAccessToken` without passing `request.signal`. The refresh's fetch has no signal or independent deadline. A token endpoint that accepts the connection but stalls keeps the caller waiting after cancellation or timeout, even though the original service request was bounded. Every later refresh for that app joins the same outstanding promise at lines 200-202. This is Important because an expired sign-in can leave tool work or an interactive connection check waiting past its promised deadline.
- Verification: a temporary Vitest probe held the refresh response, aborted the request, and confirmed the request remained unsettled until the held response was released. The mock honored a supplied fetch abort signal; none reached it. The check failed with `expected false to be true` for prompt cancellation.
- Fix: bound the shared refresh with its own deadline and let each caller stop waiting when its own signal aborts. Keep shared refresh ownership separate from any one caller so canceling one chat does not cancel another chat's refresh.
- History: introduced with the API OAuth path in `5c74ca6b3`. The refresh-sharing contract is compatible with per-caller cancellation; no declined finding accepts an unbounded wait here.

### C. An old failed API refresh deletes a newer sign-in's tokens

- Status: fixed `464106122`
- Where: [api-oauth.ts:218](/packages/workspace/src/lib/apps/api-oauth.ts#L218)
- What: the refresh reads one token pair at line 181, but an `invalid_grant` response unconditionally clears the app's current tokens. If the person disconnects and signs in again while that refresh is outstanding, its later failure deletes the newly saved sign-in, and the next request asks them to sign in again. The success path also saves its old refresh result without checking whether the stored sign-in changed. This is Important because completion of superseded work can undo the person's newer account choice.
- Verification: a temporary Vitest probe started a refresh, saved a new token pair in the same app's store while the response was held, then returned `invalid_grant`. The new access token was expected to survive; the actual stored value was `undefined`.
- Fix: compare the stored origin and token pair with the pair the refresh started from before clearing or replacing them. If a newer sign-in won, use that state or fail the superseded request without changing it. Refresh sharing should also distinguish the credential generation rather than only the app slug.
- History: this is in the newly added API OAuth path, not a reopening of the fixed MCP finding in `2026-10-21-last-day I`. The MCP provider already checks which tokens it may invalidate, and `690f0b260` records that contract. Carry the same protection into the API path.

## Checked boundaries

- Workspace placement rechecks the picked folder through `checkMoveTarget`, including rejecting a newer workspace format, before the no-restart path runs. The apparent bypass of the launch refusal check is not a finding.
- MCP refresh sharing and conditional token invalidation are present. The API findings above concern the separate API implementation.
- App redirects retain the origin guard and apply the changed POST-to-GET rules for 301, 302 and 303.
- The draft reader keeps unknown front matter on write. That preserves the old attachment text on disk, but does not make the composer consume it.

## Not covered

This review does not establish full coverage of all 206 commits. Setup's presentation, billing and provider-sheet UI, release tooling, fixture tooling, native dictation capture and shortcuts, and every provider-specific image fallback were not exhaustively reviewed. Permission changes, Claude continuation changes and request-prefix changes received source inspection, not a complete independent audit. No installed-app, Windows, Linux, macOS privacy-prompt, live vendor OAuth, or real-model checks were run. Existing findings in earlier reviews were not comprehensively retested, and this report does not close them.

The temporary probes were removed after their expected failures were recorded. No production fixes were made.
