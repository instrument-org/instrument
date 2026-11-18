# Ask the agent with a required choice, not an optional flag

Agents skip optional tool parameters, and smaller models skip them almost always. When a tool needs the agent's judgment on every call, make that judgment a required field whose values name what the person will see, placed before the payload. The model then decides while the request is fresh, and the app knows the answer before the payload streams.

**Applies when:** a feature depends on the agent saying something about the call it is already making: whether a file is the thing the person asked to see, whether a page is for the person or for the agent's own work.

- On Haiku 5.5, asked to mark the file the person asked to see as `write_file` streamed it: an optional `show` boolean marked 1 of 6 deliverables, an optional long name (`open_beside_chat_while_writing`) 1 of 5, and a required `after_writing: "open_beside_chat" | "just_save"` 5 of 6, with none of 9 support files marked and the field written before `content` every time. The name barely mattered; requiring it did.
- The failure was omission, not judgment: once made to choose, the model chose well.
- Name the values for the outcome (`open_beside_chat`, `just_save`), not for a mechanism (`true`).
- Declaring a side intent on a call the agent already makes costs a few tokens. A separate command for it costs a call and goes unused, as `show` did beside `agent-browser open` ([browsing never opens the pane](../findings/browsing-never-opens-the-pane.md)). The separate command can still exist for doing the thing on its own.
- A command line has no required field. Its form is a command that refuses to run without the choice and names both options in its error. A new verb beside one models already know from training loses to the familiar one.

**Not:** a reason to make every option required. Where one answer is right for every call, decide it in the harness and ask nothing ([load-bearing behavior lives in the harness](load-bearing-behavior-lives-in-the-harness.md)). Leave a flag optional when leaving it out fails loudly (`replaceAll` on an edit with several matches) or its default is the safe, common case. A field on one tool is never the only way a feature works, since the agent can do the same through the shell: it is an early signal on top of a point every path goes through.

**Sources:**
- `show` command lost to `agent-browser open`, recorded 2026-08-11.
- A width control the agent could set changed the page width in 1 of 66 runs, 2026-11-17.
- `write_file` shape eval (optional `show`, optional long name, required choice), 2026-11-17.
