# Load-bearing behavior lives in the harness

When something the product depends on goes wrong in the agent, make it deterministic in the harness rather than adding a prompt line or leaning on one model's habits. A prompt patch for an intermittent failure only papers over it, and it fits the model it was tested on.

**Applies when:** an agent failure recurs, or a behavior is critical to how the product feels.

- A fast first reply is guaranteed by the harness, not by one model's tendency to answer quickly.
- Read-only tools run in parallel because the harness runs them that way, not because the prompt asks for it.
- A path the agent gets wrong is resolved in code, not explained in the prompt.
- When the harness leaves something out of a tool's output, it says so briefly, so the agent is not left guessing.
- A guarantee keys off a point every path passes (the turn's end, the reply's files fence, the sandbox boundary), never one tool such as `read_file`, since the agent can do the same through bash. A tool-specific hook is a best-effort extra on top.
- Where the app cannot know a state for sure (a sign-in finished, a bot check cleared), the person presses a button (Done) rather than the app guessing; build a detector only on a signal that is deterministic.

**Not:** a reason to stop improving prompts. For the agent's judgment calls, [describing the world](describe-the-world-not-ban-the-behavior.md) is still the first tool.

**Sources:**
- Deterministic harness changes over prompt tweaks for intermittent failures, stated 2026-08-17.
- Omitted tool output is told to the agent, stated 2026-09-02.
- Harness problems get harness fixes, and read-only tools run in parallel, stated 2026-10-01.
- A fast first reply guaranteed by the harness rather than one model's habits, stated 2026-10-07.
- Path resolution fixed in code rather than in the prompt, stated 2026-10-20.
- No detector for a state the app cannot know; the person presses Done, stated 2026-11-08.
- Guarantees key off points every path passes, not one tool, stated 2026-11-15.
