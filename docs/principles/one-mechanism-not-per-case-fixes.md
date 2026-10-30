# One mechanism, not per-case fixes

When the same kind of problem shows up in several places, build the one abstraction that covers them and route each case through it, rather than fixing each control on its own. A bespoke answer to one edge case is "cute but too unique": it is one more thing to keep consistent. The same holds for how a concept looks: wherever the app already shows something, a new screen reuses that control, icon or indicator rather than drawing its own.

**Applies when:** a bug or a design need recurs across screens or controls (focus, keyboard, how a folder is shown, how a small problem is reported), or a new screen shows something the app already shows elsewhere.

- Keyboard behavior comes from each screen marking its home (`data-keyboard-home`), not from per-control focus handlers.
- Every surface that names a folder uses the one shared folder row, and right-clicking it anywhere opens the same menu.
- The agent working on a row shows the existing working dot, not a new indicator.
- An edge case gets the ordinary toast with good copy, not its own dialog.

**Not:** a reason to abstract before there are cases. Two or three real instances first. Not a freeze on design either: change the shared control, and every place that uses it follows.

**Sources:**
- Keyboard home model, landed `cea9f60de` (2026-10-26).
- Folder display rules, settled 2026-10-19.
- Same concept, same control, stated 2026-08-17, 2026-08-24 and 2026-10-24.
