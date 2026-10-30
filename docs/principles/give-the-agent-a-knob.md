# Give the agent a knob, not a proxy

When a cadence, timeout or budget needs tuning, keep one plain default and give the agent a control it can set per case. Do not key a constant to a proxy (effort level, model, request size) that does not actually predict the thing. The more flexibility the agent has, the more it can fit its behavior to the work in front of it.

**Applies when:** choosing how long to wait, how often to wake, how much to fetch, when to give up.

- How long a task takes depends on provider speed, request size and tool calls, none of which effort predicts, so the overdue threshold is not scaled by effort. The agent sets its own wake instead (`task wake <id> --in 5m`).
- Background shell processes follow the same shape: the agent decides when to look again.

**Not:** a reason to expose every internal constant. A knob is for the decisions the agent is better placed to make than a default is.

**Sources:**
- Effort-scaled overdue threshold rejected, `task wake --in` landed the same day (2026-09-11).
- [Background processes](../architecture/background-processes.md).
