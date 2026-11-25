# Plan: rainy-day refactors

Status: open. A running list; nothing on it is started. Take an entry only while main is merged up and few branches are open, since each one touches many files that other work is changing.

Each entry is code that works today and would read better, or be harder to get wrong, in another shape. None fixes a bug anyone has seen; a bug found in one of these places is fixed on its own, at once. Add an entry when a review or an audit finds such a shape across many files, with the count and how to find the sites again. Remove an entry when it lands, citing the commit in that change.

## Effects the renderer could do without

An audit of the Studio renderer's 523 `useEffect` and `useLayoutEffect` calls found 84 that could be written without an effect, and 124 that are right but repeat a shape a shared hook could hold. Rewriting one changes when its code runs relative to a render, so focus, scrolling and the order of events can move: change them a few at a time and drive the screens they touch.

- **A latest value mirrored into a ref** (55, 20 of them replaceable as they stand): `ref.current = value` in an effect so a listener reads the newest value. `useEffectEvent` says the same in one line. Find them with `rg -n -B1 -A2 'useEffect\(\(\) => \{$' apps/studio/src/client | rg 'Ref\.current = '`.
- **A parent told from a child's effect** (20): a child calls an `onChange`-style prop from an effect after its own state changed. Call it from the event that changed the state.
- **Event logic run as an effect** (15): work that follows a click or a key, done in an effect watching the state the click set. Move it into the handler.
- **State derived from props or a query** (9), and **state reset on a key change** (5): compute it during render, or key the component.
- **Shared hooks for repeated shapes**: a delayed flag (18 sites), a window event listener (14), an element's size or overflow (10), focus on open (10), refetch on window focus (5). Each copy is a few lines of effect that a named hook would hold once.

## Lint and types

- **A required `version` on file URLs**: `computer-file-url.ts` takes `version?`, and about half its callers pass none, so whether a picture can go stale is decided by omission. Make the argument required, with a value that says a copy never changes.
- **Platform-only copy**: about 25 `studio/no-os-words` exceptions each say the text shows on one system, which nothing checks. A component or helper that renders text only on that system would replace the exceptions with a check.
