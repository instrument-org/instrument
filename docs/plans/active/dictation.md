# Plan: dictation

Status: planned, not started.

## Problem

People talk to an agent more easily than they type to it, and the only way to dictate into Instrument today is the operating system's own dictation or a third-party tool that pastes. Those work, but they race the clipboard (see `docs/findings/dictated-paste-lost-to-a-status-poll.md`) and they are invisible: nothing in the composer says the app is listening. Instrument should have its own mic button wherever someone writes a few sentences.

## Decisions already made

- **Record, then transcribe.** No live transcription. The whole recording is uploaded once when the person stops, and the text lands in the box.
- **The API transcribes.** Studio never calls a speech provider itself. The API runs `@cf/deepgram/nova-3` on Workers AI with `smart_format`, `punctuate`, and `mip_opt_out`, so audio is never kept for model training. The model is the server's choice; there is no model setting.
- **Signed-in only.** Signed out, the mic looks and acts live; pressing it opens a sign-in prompt written for dictation that says it is free with an account.
- **Free up to a daily allowance.** Every signed-in user gets the same daily allowance of audio minutes, counted per UTC day, outside the plan's usage limits. A paid user who goes past it keeps dictating, counted against their plan like any other usage; that arrives with the transcription usage source in the follow-up below, and until then the allowance holds for everyone. Reaching the allowance alerts the team.
- **Nothing is kept.** Neither side stores audio or transcripts. Studio holds the recording in memory only until its text has landed, so a failed upload can be retried.
- **No keyboard shortcuts** in the first version, including Escape, so a long dictation is never thrown away by accident. No word list.
- **Where the mic appears:** the composer (chat reply and new chat), the problem report note, topic instructions, and the question card's "Add a note". Never on single-line inputs, the memory import box, or the file and code editors.

## Shape

### API

`POST /dictation` takes the recording as the raw request body (`audio/webm`, opus) and answers `{ text }`.

1. 401 without a session.
2. A per-minute burst limit per user (`DICTATION_RATE_LIMIT`), 429 `rate-limit-exceeded`.
3. Reject a declared `content-length` over 25 MB with 413, then read the body capped at the same size.
4. Check today's allowance from the ledger. Over it: once the transcription usage source exists, a paid user is admitted through billing as a metered request; anyone else gets 429 `dictation-allowance-reached` with the reset time, and the team is alerted.
5. `env.AI.run` with the body passed as a `ReadableStream` (nova-3 refuses an `ArrayBuffer` with a misleading schema error).
6. Write a ledger row from the response's `usage.neurons`, which gives the exact audio length and cost without inspecting the audio.

**The ledger** is a D1 table with one row per request, not a counter, so it doubles as the record of how much dictation is used: user, time, audio seconds, neurons, outcome, the surface it came from (sent by Studio as a header), and the detected language. It never holds audio or text. Today's total is a sum over an index on user and day.

**Alerting:** a typed PostHog event, `api.dictation.allowance_reached`, with a PostHog destination to the alerts Slack channel, masked to once per person per day. Completion and failure events carry duration and outcome only.

### Studio

- **Mac plumbing.** `NSMicrophoneUsageDescription` in `extendInfo`, `com.apple.security.device.audio-input` in the main and inherit entitlement plists (read `docs/findings/an-entitlement-that-notarizes-and-will-not-launch.md` first), and `mac.microphone.{status,request}` beside `mac.notifications`, using `systemPreferences.getMediaAccessStatus` and `askForMediaAccess`. Checked on a signed build before it reaches a beta.
- **Capture** in the renderer: `getUserMedia` with the chosen device, `MediaRecorder` with `audio/webm;codecs=opus`, and an `AnalyzerNode` for the level. Always upload the whole recording; only the first chunk of a recording carries the container header.
- **Transport.** The renderer hands the recording to main over oRPC, and main posts it to the API with the session headers, the way `platform-api/web-search.ts` does. The renderer cannot reach the API itself (CSP), and the upload must not block the main thread.
- **States.** Starting, recording, transcribing, error. While recording, the editor stays visible and editable; the action row shows Cancel at the left, a red dot and an `m:ss` clock, the level bars, then Stop and Send. Stop transcribes and appends. Send while recording transcribes, appends, and sends once the text has landed. Cancel discards. The spinner sits on whichever control was pressed. A recording under a second gets "Didn't quite catch that". Recordings stop themselves at ten minutes.
- **Appending.** The transcript goes at the end of the box, as a new paragraph when the box already has text, and never replaces what is there. Typing during recording or transcription is kept. If the box unmounts while a dictation is in flight, the text is appended to that draft's stored value (`appendToPromptAtom` already handles a draft with no mounted editor).
- **Level bars** follow the channels prototype: RMS per frame mapped to dBFS over a slowly adapting window (floor as a trailing minimum, a span of at least 26 dB), drawn as a short row of bars.
- **One hook and one button.** `useDictation` owns capture, upload, and state; `DictationButton` renders it. The composer uses them through `PromptEditorRef`; the three textareas use the same pair.
- **Settings.** A Dictation section in General after Notifications: Microphone (System default or a device) and Language (Auto-detect or a language nova-3 supports), plus a row showing the operating system's mic permission with a link to its settings. Stored in machine preferences. Device IDs differ between sessions, so the stored choice is `{ deviceId, label }`, matched by label when the ID is gone, and falls back to the default device with a notice.
- **Errors** are toasts in plain language: no mic, mic access refused (with a link to the settings), mic busy, connection lost (with Retry), allowance reached (says when it comes back).

## Follow-up: a transcription tool for the agent

A separate change, after dictation ships. A `transcribe` tool lets the agent turn an audio or video file into text, for plan and trial users, metered like web search under a new `transcription` usage source. The same source carries a paid user's dictation past the daily allowance. Because it is paid for by usage, it can expose more of what Workers AI offers than dictation does: speaker labels, timestamps, language detection, and a choice of model. It replaces the `local-ml` skill's on-device Whisper suggestion for signed-in users.

Adding a usage source needs new versions of every stored billing policy in the same deploy; a policy that does not name a reservation for a counted source fails to load.

## Risks

- **Rich editing and dictation.** The composer is ProseMirror; appending must go through its transaction path so undo, chips, and the draft atom stay correct.
- **Signed builds.** A missing or misplaced entitlement fails silently under the hardened runtime. Only a signed build proves it.
- **Real voices.** The model was compared on clean synthesized speech. Accents, noisy rooms, and laptop mics are untested until people use it.
