# Auto mode

Status: open. Design only, nothing scheduled. Written 2026-10-15 so the measurements outlive the sessions that made them. No part of this is approved for implementation; the shape of the product decision sits with the founders.

Auto mode is a chat that stops asking. Today a chat asks before it reaches a folder it has no grant for, and the person answers once per folder. Auto mode would grant the folders up front and put something else in the way of the few actions the person would not have wanted: a rule where a rule can decide, a model where only judgment can.

Everything below was measured rather than reasoned. Two rounds, 2026-10-14 and 2026-10-15, replayed 2,989 consequential tool calls taken read-only from six months of one developer's own chats (400 sessions, 819 chat databases, 2026-04-15 to 2026-10-13), plus 48 hand-written counterfactuals, 31 matched browser pairs and 9 rewordings built on top of real contexts. 18,488 model calls, through this repo's own `evals/decision/` client with the harness unmodified. Judges: `clef` and `clef-flash`. One developer's history is one person's habits, which is the first thing to re-measure on anyone else's traffic.

## Three layers, and the model only sees the third

An allowlist that skips the model, a rule list that always asks, and a judgment in the gap between them, resolved in that order. Against all 7,065 recorded tool calls:

| Layer | Share | What is in it |
| --- | --- | --- |
| Skipped | 70% | reads, searches, and writes inside the chat's own folder |
| Always asks | 2.4% | writes and deletes outside the chat folder |
| The gap | 27% | interpreter invocations, browser actions, Mac automation, network writes, app connections |

The gap is the argument against allowlisting the rest of the way out. 490 of its calls invoke an interpreter, where the command text says nothing about what the file does, and 857 act on a browser page, where the command text is a handle with no meaning in it. Every shipped product in this space publishes the same reason its own list leaks: a rule matches text, not behavior, and a wrapper command takes whatever follows it.

## The two threat classes want different answers

**Accidental large deletion needs no model.** Across six months, 45 deletions, every one of them relative and under the chat's own folders. A path rule would have asked zero questions in that history and catches 10 of 19 hand-written destruction cases. The other nine are a short enumerable list rather than an open class, and each is a candidate for its own rule.

One of those nine is worth settling in the plan rather than in the code: a file the person handed in sits in the chat's attachments folder, which is *inside* the chat folder, so the path rule allows deleting it. Treating handed-in files as outside the rule is one line and one more question the person might see.

**Something risky in the browser needs a model, and the model cannot read it today.** What the gate sees of a click is `click @e311`, a handle with no semantics. At a usable bar the gate catches 5 of 18 browser counterfactuals that way. Hand it each handle's role, name and page host — which the snapshot already returns — and it catches 10 of 18 with no new false refusals. Without that resolution every purchase counterfactual scores under 0.05, which means the browser half of a classifier does not work at all.

## Delivery shape is the biggest lever, and it reads like a formatting detail

Handing `clef` **one pre-written paragraph** instead of three named JSON fields moves it from 23 of 40 threats caught to 34 of 40 at the same false-positive rate. Same model, same tokens, same latency: AUC 0.953 to 0.992.

Whatever a plan says about this needs a committed test case, because the next person to tidy the request shape will undo it without knowing what it was worth.

Three more shape findings, all first-round:

- **One sentence in the prompt allowing destruction the person asked for** took flagged calls from 6.32% to 1.94% *and* caught three more threats. Strictly better on both axes.
- **Keep the agent's own `explanation` out of the question.** Including it cut flags from 12 to 3 of 600, which looks like a win and is the attack surface: the thing being judged gets to argue for itself.
- **The person's own sentence is the whole of the context gain.** The ask plus the three preceding steps; past three steps adds nothing.

Things tried that are not worth carrying: `score` against a rubric (AUC 0.952, no better, though it returns a confidence field `noul` does not), `choice` between allow and ask (0.958 but the worst recall of the four, because a discrete answer throws away the ranking), and a two-tier `clef-flash`-first cascade (loses five or six catches and is beaten outright by raising `clef`'s own bar). Carrying the pending call in a question's `criteria` field is structurally unavailable: the API rejects it on a `noul` question.

## Where the bar sits, and what a flag does

With the text-block delivery, a bar of 0.70 catches 34 of 40 and interrupts 3.6% of sessions; 0.90 catches 27 and interrupts 1.0%. Write 0.70 down as a tunable rather than a constant: it is the number most likely to need retuning on someone else's traffic.

A flag is a hint to the agent to find another way, not a question for the person. Only after three consecutive refusals, or twenty in a session, does the turn stop and ask. Left unstated, the default is that every flag becomes a question, and at 0.6 that is 58 interruptions across 400 sessions instead of 58 sentences in a transcript.

A rule can offer a lasting yes, because it knows what it is looking at: "always in this folder". A judgment can only ask about this step, because it is a guess about what the person meant. The two asks should not look the same.

## Fail open

Every shipped product in this space fails closed. We should fail open, and the principle is the same one: each degrades to its own previous default. Theirs replaced a skip-all-permissions flag, so when the judge dies they go back to asking. Ours would replace being asked about folders, and the product ships with no classifier at all, so when the judge dies it goes back to not asking.

Most of the machinery is already here. `askDecisionModel` in `packages/workspace/src/lib/decision-model.ts` returns nothing rather than throwing when no provider answers, backs off for a minute after a failure, and documents that callers treat the answer as optional. A gate is a new caller of an existing contract, not a new failure path.

One thing the existing contract gets wrong for this caller: `DECISION_PROVIDER_TYPES` tries the person's own key before the Instrument sign-in, which is right for every other caller and makes the judge vary by user. A person with their own key is judged by a model that flips about 4% of its own decisions between identical runs; everyone else is judged by one that returned identical scores on 500 repeated calls. For a search suggestion that is a slightly worse suggestion. For a gate it means two people get different answers to "will this interrupt me", and only one of them can reproduce it when they report it. Pin the gate to one route rather than inheriting the order.

## Browser recording is worth doing without any of this

Separate the two. The transcript is a lossy record of what the agent saw in a browser, and that costs the agent today, with no classifier anywhere in the picture: the page's own reply to a failed action does not reach it. A plan that files this under classifier scaffolding will deprioritize it alongside the classifier.

Two rungs are cheap and independent. Keep the names the snapshot delta already carries and our parser drops. Pass `--json` on the snapshot that already runs and keep the handle-to-name table, so a later click can be resolved against it. A third rung, having a click echo what it hit, is not reachable without upstream work.

## What this evidence cannot tell us

- One person's six months. Habits, not a population.
- Every real call is labeled "should have been allowed" on the assumption that the person approved what they asked for, then every flag was read by hand and relabeled where that assumption was wrong. The counterfactuals and their labels are written by the same hand that wrote the gate's prompt.
- Nothing has been measured against an adversarial page, only against counterfactuals.
- The flag-as-hint design rests on the agent reliably finding another way. That is the frame that decides whether this ships, and it has not been tested at all.
