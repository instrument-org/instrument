# Tasks report to their chat, not to each other: typed signals up the tree, peer messaging deferred

Date: 2026-09-29

## Context

A chat delegates to tasks through the `task` command. The chat reaches a task with `task new`, `task send` (heard at the task's next step), `task send --now` (stops the step in flight and runs the message next), `task stop`, and grants (`task folder`, `task app`, `task tab`). A task reaches its chat in one way: by finishing a turn, whose last message wakes the chat. The chat also gets a periodic "taking a while" note listing a working task's steps. Chats can read one another (`chat read`, `chat search`) but not send.

First-install testing turned up three places where that tree goes blind. A GLM 5.3 Flash task repeated one line for five minutes inside a single step; the "taking a while" note named its last tool call, the chat read that as busy research, and `task send` waited for a next step that never came. A task that needs a folder, an app, or an answer finishes a turn exactly the way a task that is done does, so the chat has to find the request in prose. And a task handed a folder macOS was still asking the user about sat in a state no other command knew.

At the same time, OpenAI described a run of about 10,000 agents that message one another directly (Noam Brown on the Dwarkesh Podcast, 2026-09-17, on the Navier–Stokes run), which raised the question of how far to go: a task messaging its chat mid-turn, tasks messaging one another, any agent messaging any agent, and chats messaging chats.

## Options weighed

1. **Typed signals up the tree.** The chat stays the only agent that directs work. A task gets a typed way to say it is blocked, and the chat gets a terse account of the step in flight. Messages still arrive only where the harness delivers them.
2. **Chat to chat.** A `chat send` beside `chat read`, so one conversation can hand a finding or an answer to another.
3. **Task to sibling task.** Tasks of one chat message each other directly, or share a notes file.
4. **Any agent to any agent.** Every agent can address every other, the arrangement Brown described.

## What the evidence says

| Source | Finding | Kind |
| --- | --- | --- |
| [Noam Brown, Dwarkesh Podcast](https://www.dwarkesh.com/p/noam-brown), 2026-09 | Messages go straight into the recipient's context. They "interrupt their chain of thought", and untrained agents "collapse to... solve the problem independently", which he calls a local minimum. Four agents finish about twice as fast for about twice the tokens, "slightly sublinear". OpenAI's own post has agents talking within groups, with people steering by follow-up prompts. Secondary reports put the training that made it work at about a year of multi-agent RL. | anecdote, with OpenAI's own 1/4/16-agent plots |
| [Anthropic, multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system), 2025-06 | A lead with subagents and no peer messaging beat one agent by 90.2%, at about 15x the tokens. Names the synchronous handoff as the bottleneck: "the lead agent can't steer subagents, subagents can't coordinate". Results pass through files to avoid a game of telephone. | measured |
| [Cognition, multi-agents working](https://cognition.com/blog/multi-agents-working), 2026-04 | "Multi-agent systems work best today when writes stay single-threaded and the additional agents contribute intelligence rather than actions." A sub-agent writing back to its manager "doesn't happen by default, because models haven't been trained in environments where it needed to." | practitioner opinion |
| [Kim et al., Towards a Science of Scaling Agent Systems](https://arxiv.org/abs/2512.08296) | Across five architectures, multi-agent results range from +80.8% on decomposable work to −70.0% on sequential planning; architectures without centralized verification propagate errors more. | measured |
| [Cemri et al., Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657) | Across 1,600+ traces from seven frameworks, failing to ask for clarification, withholding information, and ignoring other agents' input are recurring failures. | measured |
| [Claude Code cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging) | A message is read between tool calls and never interrupts one; an idle session gets a new turn. Each session accepts, holds, or refuses inbound messages; bursts are refused, repeats throttled, the queue capped at 50, so a loop "stops on its own". A message never counts as the user's consent. | shipped design |
| [A2A protocol](https://a2a-protocol.org/latest/specification/) | Task states include `input-required` and `auth-required`: a standard shape for "blocked, needs this". | spec |
| [LangChain, benchmarking multi-agent architectures](https://www.langchain.com/blog/benchmarking-multi-agent-architectures) | A supervisor gained about 50% from forwarding a worker's reply verbatim and trimming handoff chatter. | measured, not rechecked here |

The one strong any-to-any result rests on a model trained for it, scoped into groups, and steered by people. Where hierarchy and peer arrangements were measured side by side, central verification contained errors that peer messaging spread. Nothing measured shows a gain from chat-to-chat messaging; the design that exists for it is careful about loops and consent rather than about capability.

No source compares a message tool with a shell command. Every system surveyed delivers inbound messages by injecting them at a step boundary or waking an idle agent, never by polling.

## Decision

Option 1 now. The chat stays the only agent that directs work, and the tree gets typed signals:

- The chat sees the step in flight: how long it has run, how long since the last tool call, and whether the model is writing with no tool call, which is what a stuck step looks like.
- A task that cannot go on without something ends its turn with a `needs` fence in its last message, the way the `files` fence names what it made, and the wake note says the task is waiting on the user rather than finished. It is a marker on the one channel a task already has, not a new channel.
- A task that is created but held (on a macOS folder answer today) carries a visible waiting status that every command respects.
- Sending stays a command beside the others (`task send`, `task send --now`); receiving stays the harness's job.

Option 2 waits for a use case. If one comes, it follows the cross-session design above: addressed by name, inbound accept/hold/refuse owned by the person, bursts refused and loops throttled, and a message that never stands in for the user's consent.

Options 3 and 4 are deferred.

## Why

The failures we have seen are all visibility failures between a chat and its own tasks, and typed signals fix them without adding a single channel. The research agrees on the two points that decide the rest: untrained models under-use a message channel and lose reasoning to interruptions, and peer arrangements without a verifier spread mistakes. The chat already is our verifier. What Brown described is real, but it is a property of a model trained for it, not of the arrangement.

## What would change it

- A model we run that is trained for multi-agent messaging, or a measured gain from peer messaging on work like ours (research, files, browser tasks), would reopen options 3 and 4.
- A concrete need for one conversation to hand another an answer (a long-running chat waiting on a decision another chat settles) would start option 2.
- If the `needs` fence goes unused in evals across models, the blocked signal becomes a tool call rather than a fence; the decision to type it stands.
