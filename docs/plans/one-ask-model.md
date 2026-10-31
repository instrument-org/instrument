# One ask model

Status: open.

## Problem

What a chat waits on the person for is kept three ways, each answered its own way:

- **Permission cards** are a `card` record the owning computer writes whole and `answer` records from any device (`chat/asks.ts`, `chat/card-answers.ts`). The card carries `answer`, `failed`, `spent`, `allowed`, `status` and `closedAt`; the control flow lives beside it in process memory (`acting`, `inFlight`, `settling`, two write queues), and recovery after a crash (`isDue`) is a second path beside the normal one. The 10-31 review's G and H came out of that gap.
- **Questions** (`choose`) are no record at all: an open question is a `tool-choose` call with no answer written on it, no message typed after it and no Stop since (`chat/open-asks.ts`). Whichever device the person answers on writes the answer onto the call and wakes the chat, guarded by an in-process `Set`, so two devices answering within one sync both write and both start a turn.
- **Sign-ins** are a `tool-connect_app` call whose rows read their state live from this computer's `app-connections.json` (`apps/sign-in-group.ts`), with the chat on the connection's `waitingChats` (`apps/connection.ts`), woken by `apps/events.ts`. Another device shows the card with its own connection state, which says nothing true about the computer that asked.

## Design

One record for everything a chat waits on, one fold that says where each stands, and one driver on the computer that asked that does what is still owed. Every device shows the same state and may answer; the asking computer alone acts.

### Records (chat's own session log)

- `ask`: the ask whole, written only by the computer it belongs to (`device`), the newest record of an id standing. Common fields: `id`, `device`, `askedAt`, `askers` (session, `at` by the owner's clock, `partId`, `reason`, `waits`), and `kind` with its payload:
  - `permission`: `on` (`folder`, `app`, `tab`), `target`, `page`, `programs`.
  - `question`: the call's `partId` and `messageId`, `questions`.
  - `sign-in`: the call's `partId`, `apps` (slugs).
- Its `stage`, one value rather than six optional fields: `open`; `taken` (the answer it took, by `device` and `at`, with its payload); `waiting` (on the system: `macos-asking`, `macos-refused`, `macos-private`, `windows-blocked`, keeping the taken yes); `closed` (`outcome`, `woken: boolean`). `failed` (the last taken answer that could not be carried out, and why) and `spent` stay, since they are what lets a card be answered again.
- `answer`: from any device, in its own log: `ask`, and a payload by kind: `permission` `allowed | always | declined`; `question` the replies; `sign-in` `declined` (Not now; signing in happens on the owner only); or `stopped` naming asker entries, as today.

`card` records are not read any more. Nothing outside internal testing has one; a card left open across the update is asked again.

### Fold

`askStates(records)` is a pure function from a session's `ask` and `answer` records to each ask's state: the stage the owner wrote, the askers no Stop took off, and the first answer in log order not spent (`pending`) when the stage is `open`. Every reader (the card UI, the chat list's "waiting on you", `stoppable`, the driver) reads this and nothing else.

### Driver (owner only)

`driveAsks(chatId)` runs on each `session` record change and once per chat at launch, one pass per chat at a time, and moves every ask of this device's one step at a time, writing the ask after each:

1. `open` with a `pending` answer: write `taken`.
2. `taken`: carry it out by kind. Permission: grant or deny (`permissions.json`), move a tab, look as the app on macOS (`waiting` while macOS asks or refuses). Question: write the replies onto the `choose` call. Sign-in `declined`: dismiss the connections. A failure writes `failed` and `spent` and returns to `open`.
3. Carried out: write `closed` with the outcome and `woken: false`.
4. `closed`, `woken: false`: wake every asker with the outcome, then write `woken: true`. The wake note names the ask's id, and a session that already holds a note for that id is not woken again, so a crash between the note and `woken: true` wakes nobody twice.

Each step reads its input from the fold, so a launch after a crash resumes at the step it stopped on: recovery is the normal path. A Stop from any device takes askers off as today; an ask nobody is left on closes with no wake. The person's own action on this computer (Allow on the card) appends an `answer` like any device and runs a pass, and its call settles when that ask leaves `taken`.

#### Fresh answers only

What another device does is acted on live only. An answer, from any device this one's own included, is taken only while fresh: given within `ASK_FRESH_MS` (ten minutes, `isFreshAsk` in `@instrument-org/shared`, the window a phone's asked-to-send drafts already used) of now, by the answer's own `at`. This compares the answering device's clock with this one's on purpose, as the drafts do: the question is how long ago the person acted. The check is in the fold (`askStates` takes `now`; `pending` is the first fresh unused answer), so a pass a sync arrival starts at launch takes no stale answer either.

- A stale answer is not taken and not spent: the ask stays open and answerable, and the fold reports the newest such answer as `away`, so the card says it was answered on that device while this computer was away and asks again.
- An ask found part-way (taken, or closed with `woken: false`) whose answer was given before this process started and is no longer fresh finishes its bookkeeping (a grant already made stays, the ask closes), and its askers get the outcome as a note that starts no turn, read with the person's next message.

#### Deviations, as built

- The macOS look inside an allowed folder or app runs beside the passes, keyed by ask id, since macOS's own prompt can stay up for minutes and a No given meanwhile must not wait behind it. What it finds is written through the same ask writes (closed, or `waiting`), and a pass after it wakes the askers. A crash during the look leaves the ask `taken` (looked at again) or `waiting macos-asking` (the card's retry), as before.
- A later No closes a yes under way (taken, or waiting on the system) only when given on the ask's own computer, where the system's prompt is; another device's later answer never overrides the first.
- A Stop on the ask's own computer is written as a `stopped` answer like any device's, so every reader sees it at once and the driver closes an ask nobody is left on.
- A No whose refusal cannot be kept in `permissions.json` still closes the ask and wakes its askers, and the failure is reported rather than failing the person's call.
- A sign-in's rows carry each app's standing as the asking computer last wrote it, and its outcome carries the app events the chat is woken with (and, for a card of several apps or one whose call could not ask for some, the card as it stands and those apps). The owner's app events settle it through `refreshSignIn`, found by scanning this computer's live sign-in asks (the chat digests) for the event's app, in place of `waitingChats`. A failed sign-in still wakes at once with the card as it stands and leaves the ask up. An answer on a card's row the chat no longer waits on (settled, or written past) raises a one-app sign-in ask on the same call (`waitInChat`), which the answer settles. A card of one app now tells the account a sign-in learned, as a card of several did. Not now from another device is a `sign-in` answer; the owner turns down every waiting app on the card (`recordConnection` declined, with the app event), which settles it. Another device's card offers Not now through `chats.declineSignIn`.
- A question's ask id is its `choose` call's part id, the id the card already answered by, and the call raises it as it runs. Whether the person moved past an open question (or sign-in) is read from the session itself (`movedPastOf`): a typed message after the call's message, by message order rather than by clocks, or a Stop of theirs since it was asked. The fold takes that beside the ask and answer records.

### Sign-in

Signing in stays on the computer that asked: OAuth runs on its loopback server and the credentials stay in its `keys/`. `connect_app` raises a `sign-in` ask; the owner's app events (`apps/events.ts`) carry it to `closed` when every row settles, instead of `waitingChats`. Another device draws the card from the ask (which apps, which have settled, as the owner last wrote it) with "Sign in on <computer>", and may say Not now. `waitingChats` goes.

### What the person sees

`Ask` stays one union in `chat-state.ts`, with `here`, `computer`, `answerable` and `answered` for every kind. A question answered on one device shows as answered, waiting for the computer that asked, on every other, until that computer takes it. `chats.answerQuestion` and `permissions.answer` both append an `answer` and, on the owner, run a pass.

## Steps

1. Records, fold and its tests (`ask`, `answer`, `askStates`), with `card` dropped.
2. The driver, with permission cards moved onto it; `acting`, `inFlight`, `settling` and `isDue` go.
3. Questions onto it: the route appends an answer, the owner writes the call and wakes.
4. Sign-ins onto it; `waitingChats` goes.
5. Studio: cards, questions and sign-in cards read `here`/`answerable`/`answered` from the ask.
6. Docs: the root `CLAUDE.md` layout paragraph, `chat-records.md`.

Each step lands with its tests, and the end is checked with two dev Studio instances on one clean-room workspace (two device ids), answering a folder card, a question and a sign-in's Not now from the instance that did not ask.

## Open points

- A question answered while the asking computer is off waits for it, and if it stays off past `ASK_FRESH_MS` the answer is not taken when it comes back: the card asks again. Before this, the device answered on started the turn itself; nothing short of an owner can make that exactly once, and acting on a stale answer would start work nobody is watching.
- A pending answer turning stale changes nothing in the records, so a card shows it as waiting for the asking computer until the chat's records next change.
