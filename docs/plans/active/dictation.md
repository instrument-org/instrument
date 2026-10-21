# Plan: dictation

Status: in progress.

## Problem

People talk to an agent more easily than they type to it, and the only way to dictate into Instrument today is the operating system's own dictation or a third-party tool that pastes. Those work, but they race the clipboard (see `docs/findings/dictated-paste-lost-to-a-status-poll.md`) and they are invisible: nothing in the composer says the app is listening. Instrument should have its own mic button wherever someone writes a few sentences.

## Decisions already made

- **Live, with the recording as the fallback.** While the person talks, the box shows the words as nova-3 hears them over a WebSocket, where they will land, so what lands at Stop is what they saw. The whole recording is still kept in memory, and when the stream can't open, drops, or misses part of the take, it is uploaded at Stop as before. A streamed minute costs about 1.8 times an uploaded one ($0.0092 against $0.0052 at list price), and a take that falls back is paid for twice.
- **The API transcribes.** Studio never calls a speech provider itself. The API runs `@cf/deepgram/nova-3` on Workers AI with `smart_format`, `punctuate`, and `mip_opt_out`, so audio is never kept for model training. The model is the server's choice; there is no model setting.
- **Signed-in only.** Signed out, the mic looks and acts live; pressing it opens a sign-in prompt written for dictation that says it comes with an account.
- **Billed like search.** Dictation is the `transcription` usage source, metered like web search. Plan and trial accounts dictate against their plan's limits; a free account spends its free window, then billing refuses dictation the way it refuses everything else. There is no separate daily allowance and no ledger of its own. Studio shows a refusal in the billing note's own words, with the same way forward (a plan, an upgrade, a trial).
- **Nothing is kept.** Neither side stores audio or transcripts. Studio holds the recording in memory only until its text has landed, so a failed upload can be retried.
- **No keyboard shortcuts** in the first version, including Escape, so a long dictation is never thrown away by accident. No word list.
- **Where the mic appears:** the composer (chat reply and new chat), the problem report note, topic instructions, and the question card's "Add a note". Never on single-line inputs, the memory import box, or the file and code editors.

## Shape

### API

`POST /dictation` takes the recording as the raw request body (`audio/webm`, opus) and answers `{ text }`.

1. 401 without a session.
2. A per-minute burst limit per user (`DICTATION_RATE_LIMIT`), 429 `rate-limit-exceeded`.
3. Reject a declared `content-length` over 25 MB with 413, then read the body capped at the same size.
4. Admit it through billing as a metered `transcription` request. A refusal is billing's own: 429 `usage-limit-exceeded` with `resetsAt` and `Retry-After`, 402 `subscription-required` with a `reason`, or 429 `concurrency-limit` / `meter-unavailable`, the bodies search gets.
5. `env.AI.run` with the body passed as a `ReadableStream` (nova-3 refuses an `ArrayBuffer` with a misleading schema error), answering 415, 413, 400 (no audio) or 502 when it can't.
6. Meter the request from the response's `usage.neurons`, which gives the exact audio length and cost without inspecting the audio.

`GET /dictation/stream` upgrades to a WebSocket after the same session, burst-limit, language, and billing checks, answering 401, 429, 400, or billing's refusal before upgrading, and 426 to a plain request. It opens nova-3's socket through the AI binding (`env.AI.run(model, options, { websocket: true })`, options as strings), and relays the take's WebM/Opus chunks as they arrive. The client sends binary audio, `stop`, and `keepalive`; it hears `text` (interim or final) and one `end`, which says whether the model heard the whole take (its reported duration against the span between the first and last frame), and why it ended: Stop (`stopped`), a billing limit reached mid-take (`limit`), or a failure (`failed`). A `limit` end names no refusal, so Studio reads `billing.status().features.dictation` for what to say. A socket nova-3 refuses (3040 capacity) answers 502 and charges nothing.

Completion and failure events carry duration and outcome only, with the surface it came from (sent by Studio as a header), the detected language, and whether it was uploaded or streamed. Neither audio nor text is recorded.

### Studio

- **Mac plumbing.** `NSMicrophoneUsageDescription` in `extendInfo`, `com.apple.security.device.audio-input` in the main and inherit entitlement plists (read `docs/findings/an-entitlement-that-notarizes-and-will-not-launch.md` first), and `mac.microphone.{status,request}` beside `mac.notifications`, using `systemPreferences.getMediaAccessStatus` and `askForMediaAccess`. Checked on a signed build before it reaches a beta.
- **Capture** in the renderer: `getUserMedia` with the chosen device, `MediaRecorder` with `audio/webm;codecs=opus` writing a chunk every 250 ms, and an `AnalyzerNode` for the level. Each chunk goes to the live stream in order from the first, since only the first carries the container header, and the whole take is kept for the upload.
- **Transport.** The renderer cannot reach the API itself (CSP), so main holds the stream's socket with `ws` and the session headers: `dictation.listen` opens it and yields what it hears, `dictation.feed` and `dictation.finish` carry the chunks and Stop. The upload goes the same way, posted from main the way `platform-api/web-search.ts` does.
- **States.** Starting, recording, finishing (the stream settling its last words, about a tenth of a second) or transcribing (the upload), error. While recording, the words being heard show inside the box at the end of what is written, after a space on its last line, exactly where they will land: settled words in full, the stretch still being heard fainter, then a mark at the spot. What is written stays editable. The controls sit together at the right of the box's control row (in the reply box, a row under the words, so the words keep the width they land at): a small wave of the mic's loudness (newest at the right, scaled to the voice rather than the room), then Cancel and Stop. Send and the model picker are hidden meanwhile; Enter still stops and sends once the words land. Each control has a tooltip (Cancel, Stop). A soft rising tone plays as the mic starts listening and a falling one as it stops, with a Sounds switch in Settings. The words land where they were shown, so several takes in a row read as one run of sentences, and the box always appends, wherever the caret is. When the stream drops or never opens, "Live text unavailable" stands in for the words. A recording under a second gets "Didn't quite catch that". Recordings stop themselves at ten minutes. Closing the box mid-recording finishes it and lands the words in that draft; quitting mid-recording asks first ("Quit while dictating?").
- **Appending.** The transcript goes at the end of the box, after a space on its last line, and never replaces what is there. Typing during recording or transcription is kept. If the box unmounts while a dictation is in flight, the text is appended to that draft's stored value (`appendToPromptAtom` already handles a draft with no mounted editor).
- **Dictated words are marked.** The composer marks the words it appends as dictated, serialized as `[words](dictated:)`; people see plain words everywhere, and the model reads them in `<dictated>` tags with a note that they were spoken, so it can read past sound-alike mistakes. Editing inside them keeps the mark; words typed after them are not marked.
- **One hook and one button.** `useDictation` owns capture, upload, and state; `DictationButton` renders it. The composer uses them through `PromptEditorRef`; the three textareas use the same pair.
- **Settings.** A Dictation section in General after Notifications: Microphone (System default or a device) and Language (Auto-detect or a language nova-3 supports), plus a row showing the operating system's mic permission with a link to its settings. Stored in machine preferences. Device IDs differ between sessions, so the stored choice is `{ deviceId, label }`, matched by label when the ID is gone, and falls back to the default device with a notice.
- **Errors** are toasts in plain language: no mic, mic access refused (with a link to the settings), mic busy, connection lost (with Retry), and billing's refusal in the billing note's words with its action. An upload billing refused keeps the recording, with Try again beside the plan action; a take billing ended mid-stream lands what was heard.

## Follow-up: a transcription tool for the agent

A separate change, after dictation ships. A `transcribe` tool lets the agent turn an audio or video file into text, for plan and trial users, metered under the same `transcription` usage source dictation uses. Because it is paid for by usage, it can expose more of what Workers AI offers than dictation does: speaker labels, timestamps, language detection, and a choice of model. It replaces the `local-ml` skill's on-device Whisper suggestion for signed-in users.

## Risks

- **Rich editing and dictation.** The composer is ProseMirror; appending must go through its transaction path so undo, chips, and the draft atom stay correct.
- **Signed builds.** A missing or misplaced entitlement fails silently under the hardened runtime. Only a signed build proves it.
- **Real voices.** The model was compared on clean synthesized speech. Accents, noisy rooms, and laptop mics are untested until people use it.
