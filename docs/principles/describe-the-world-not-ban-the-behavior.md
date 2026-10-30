# Describe the world, don't ban the behavior

When the agent does something redundant or odd, fix it by telling it plainly what is true: what the person sees, what a command did, what is on screen. A correct belief produces correct behavior across cases; a prohibition aimed at one observed misbehavior overfits and makes the agent worse elsewhere.

**Applies when:** changing a system prompt, a tool description, a tool result, or a skill because a transcript went wrong, or adding to what the agent reads by default.

- Describe the screen and the outcome first ("the card shows the question, its choices, and Skip"). Put the description where the model reads it at the moment it acts, which is often a tool's result rather than its description.
- Do not tell the agent where a kind of information lives ("a person's email: check Contacts first") or where a kind of thing goes. Listing the places it can reach is fine; telling it which one a thing is in is not. That is the agent's call in the moment.
- One transcript where the agent picked differently than the person wanted is not a prompt bug. A fix has to hold across chats and models: do not fit it to one transcript, one bug or the model under test, and count an eval win only when the change is general.
- Reach for a prohibition only when a light eval shows the description is not enough.
- What the agent reads by default is terse and direct. Leave out what models already know or are trained to do (batching tool calls), and put an edge feature's detail in a skill loaded when needed: text in front of the agent by default costs tokens and makes it reach for that feature too often.

**Not:** a reason to leave real gaps unexplained. If the agent lacks a fact, give it the fact.

**Sources:**
- `c4039fbfd`: stopped naming Reminders as where a task's later work goes (2026-10-05).
- Stated 2026-10-15, on the `choose` tool restating its question under the card.
- Never overfit to one chat or one model, stated 2026-10-01, 2026-10-07 and 2026-10-10.
- Agent-facing text terse and loaded on demand, stated 2026-10-06, 2026-10-16 and 2026-10-18.
- [Just-bash upstream](../architecture/just-bash-upstream.md) asks the same before adding a prompt line that steers around sandbox behavior.
