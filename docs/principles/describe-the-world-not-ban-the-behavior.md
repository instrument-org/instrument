# Describe the world, don't ban the behavior

When the agent does something redundant or odd, fix it by telling it plainly what is true: what the person sees, what a command did, what is on screen. A correct belief produces correct behavior across cases; a prohibition aimed at one observed misbehavior overfits and makes the agent worse elsewhere.

**Applies when:** changing a system prompt, a tool description, a tool result, or a skill because a transcript went wrong.

- Describe the screen and the outcome first ("the card shows the question, its choices, and Skip"). Put the description where the model reads it at the moment it acts, which is often a tool's result rather than its description.
- Do not tell the agent where a kind of information lives ("a person's email: check Contacts first") or where a kind of thing goes. Listing the places it can reach is fine; telling it which one a thing is in is not. That is the agent's call in the moment.
- One transcript where the agent picked differently than the person wanted is not a prompt bug.
- Reach for a prohibition only when a light eval shows the description is not enough.

**Not:** a reason to leave real gaps unexplained. If the agent lacks a fact, give it the fact.

**Sources:**
- `c4039fbfd`: stopped naming Reminders as where a task's later work goes (2026-10-05).
- Stated 2026-10-15, on the `choose` tool restating its question under the card.
- [Just-bash upstream](../architecture/just-bash-upstream.md) asks the same before adding a prompt line that steers around sandbox behavior.
