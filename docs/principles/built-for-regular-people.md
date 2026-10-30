# Built for regular people

Using Instrument should never make the technical details underneath a primary concern. The person works at a more useful level, with their files, their apps and what they want done, and the app keeps its own vocabulary and plumbing out of sight and says things the way the person thinks of them. That is what makes it work for people who are not developers, and it is just as true for people who are.

**Applies when:** writing copy, naming a folder or path on screen, choosing what a setting or error exposes, deciding whether a failure mode is acceptable because "a developer would understand".

- A path starts at the home folder's own name or reads by place (`iCloud Drive › Instrument`), never with `~`. Copy Path still copies the real absolute path.
- No internal words in the UI: not "prompt", not "turn", not provider or model ids where a name will do.
- No developer information on screen: timings in milliseconds, provider routing, request ids.
- Folder actions keep the person in the product ("Open in Files") rather than sending them to a system tool.
- Instrument is not a coding app or a developer tool. Git and terminals are niche, integrations aim at the AI people already use, and designs do not center on developer features.
- Nothing a person needs requires opening a terminal: the app installs what it needs and handles sign-in itself.
- Raw commands and internal ids stay off the screen. At most, a raw command sits behind a drill-in.

**Not:** a reason to hide what a person needs to know. Plain words, same facts.

**Sources:**
- Folder display rules, settled 2026-10-19; place-by-place paths landed in `5826990bc` (2026-10-26).
- Design verdicts from the 2.0 rounds (2026-09): never "prompt" in UI, no dev info in UI.
- UI labels name the actor and avoid "turn" (2026-10).
- The UI copy rules in the root `CLAUDE.md`.
- The person works above the technical details, stated 2026-10-30.
- Raw commands behind a drill-in, stated 2026-08-20; no internal ids in chips, 2026-08-24.
- Not a coding app or a developer tool, stated 2026-10-06, 2026-10-10 and 2026-10-15; no terminal, 2026-10-07.
