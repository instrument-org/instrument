# Give the agent the truth, not clever affordances

Show the agent the real system: real paths, the real records, raw formats it can read with the tools it already knows, and results that say what actually happened. The layers we added to help it (virtual paths, rewritten output, a purpose-built retrieval agent, markers wrapped around content) each ended up costing it context and detours, while the truth lets it reason, pipe and combine. When agents in real transcripts already reach for something, build around that rather than inventing a new concept.

**Applies when:** deciding how the agent sees files, chat history, folders, tool output or another chat's data; choosing between a purpose-built tool and plain read access.

- The agent works at real paths. Containment comes from the operating system holding every process to the Permissions rules, not from virtual mounts or output rewritten back to fake paths.
- Another chat's history is the records already on disk, reached through one environment variable and read with ordinary commands, not a new tool or a copy.
- Programs on the PATH run by name. Withholding a name protected nothing a script could not already do.
- Outside content arrives unwrapped, so it pipes like any other output.

**Not:** a reason to drop containment, which lives in the sandbox and the folder and app grants. Not a license to put everything in the default prompt: the truth is reachable, not recited. Not a claim that outside content is trustworthy.

**Sources:**
- Truth over affordances, stated 2026-10-06 and 2026-10-12; pave the cow path, 2026-09-04.
- [The agent works at real paths](../decisions/2026-10-11-the-agent-works-at-real-paths.md) (2026-10-11); remaining path masking removed, stated 2026-10-13.
- [Programs on the PATH run natively](../decisions/2026-10-12-programs-on-path-run-natively.md) (2026-10-12).
- [Outside content arrives last and unmarked](../decisions/2026-10-09-outside-content-arrives-last-and-unmarked.md) (2026-10-09).
- [Drop the agent tool for attached-folder mounts](../decisions/2026-07-15-drop-agent-tool-for-attached-folder-mounts.md) (2026-07-15).
- Every chat's records readable by the agent, landed `79abdd81f` (2026-10-18).
