# Plan: the code React Compiler never sees

Status: proposal, not started. Owner: TBD. Written after two frozen-clock bugs traced to the same root: a value read during render that the compiler cached and never recomputed.

## Problem

React Compiler is on for Studio (`reactCompilerPreset()` in `electron.vite.config.ts`). It rewrites components and hooks so their outputs are cached against the inputs it can see. Two consequences follow, and neither is visible in the source:

1. **A render that reads something the compiler cannot see gets frozen at its first value.** `ReasoningMessage` measured a running thought against a `new Date()` read during render; the compiler keyed that read on `endedAt` and `isLoading`, neither of which moves while a thought runs, so the row said "Thinking" for the whole run and only ever showed a number once it was over. `useRelativeTime` had the same shape with `getSharedNow()`, freezing each instance's tick cadence at whatever its age was on mount.
2. **The compiler only rewrites what it recognises as a component or a hook** — a capitalised name, or one prefixed `use`. Everything else it walks past, however much JSX it builds. That is a naming convention silently deciding whether code is optimised.

Both are fixed where they were found. This plan is about the rest of the surface.

## What the audit found

Every `.tsx` under `apps/studio/src/client` was parsed for top-level functions that build JSX but carry neither a capitalised nor a `use`-prefixed name, then compiled to confirm the compiler skipped them. Test helpers are excluded below: they build JSX too, but nothing there is on a render path.

### A. Components in disguise — worth fixing, mechanically safe

`markdown.tsx` passes three lowercase functions to `ReactMarkdown` as component types:

| Function | Renders for |
| --- | --- |
| `markdownPre` | every fenced block |
| `markdownOrderedList` | every ordered list |
| `markdownCode` | every code span and every fenced block |

React calls these through `createElement` exactly as it calls any component. They are components in every respect except the capital letter, and that letter is the whole difference: two functions with identical bodies compile differently on casing alone, the lowercase one emitting no cache at all.

`MarkdownLink` in the same file is already capitalised and already compiled, so the convention is half-applied here rather than absent.

The `img` override is an arrow function written inline in the `components={{...}}` object. It is inside the compiled `Markdown` component, so its identity is cached, but its body is never compiled as a component either.

**Fix:** rename to `MarkdownPre`, `MarkdownOrderedList`, `MarkdownCode`; lift `img` to a named capitalised component. No behaviour changes — the compiler starts caching bodies that currently rebuild per element. This is the highest value for the lowest risk in this plan, and markdown renders on every message in every transcript.

### B. Render helpers on the transcript path — needs measurement before changing

`renderChatPart` (`chat-stream-render-part.tsx`) and `renderDataPart` (`chat-stream-data-parts.tsx`) are module-level functions that build a row's JSX. Neither file receives any compiler output at all — no `react/compiler-runtime` import is emitted for either.

The cost is bounded but real. `chat-stream.tsx` *is* compiled, and it calls these inside a cache block, so on a re-render where that block's inputs are unchanged they do not run. The catch is what those inputs are: the message list, which is replaced on every streamed chunk. So the whole loop re-runs per chunk and every row's JSX is rebuilt.

That would be harmless if the rows themselves stopped there. They do not — see C.

**Fix:** turning these into components would give each row its own cache and its own bail-out. It also changes reconciliation identity, so mount and unmount behaviour around groups and stand-in rows needs checking, and the transcript is the app's hottest path. Measure first.

### C. `memo()` on the transcript rows cannot fire

Five components use `memo`. Four of them take a `part`, `message`, or `task` object:

| Component | Prop | Compare can succeed |
| --- | --- | --- |
| `Markdown` | strings and booleans only | yes |
| `ReasoningMessage` | `createdAt: Date`, `endedAt: Date` | no |
| `AssistantMessage` | `part` | no |
| `UserMessage` | `part` | no |
| `NavTaskItem` | `task` | no |

The cause is one line of TanStack Query behaviour. Structural sharing preserves object identity by recursing through plain objects and arrays, but a `Date` is neither, so `replaceEqualDeep` returns the new instance, marks the parent changed, and the change propagates to the root. Every message and every part gets a fresh object on every update:

| `metadata.createdAt` | message identity kept | part identity kept |
| --- | --- | --- |
| `Date` instance | no | no |
| ISO string | yes | yes |

Parts carry real `Date` instances client-side (the store round-trips them through superjson), so `memo`'s shallow compare fails on `createdAt` for every row on every chunk. Those four memos skip nothing.

**Do not remove them.** They cost one shallow compare, which is nothing, and they are the mechanism that starts working the moment identity is fixed. Removing them removes the payoff of C without removing any cost.

**Fix:** stop hydrating these timestamps into `Date` instances at the boundary, or hand the rows primitives (`createdAt.getTime()`) instead of `Date` objects. Either makes structural sharing preserve identity, at which point the existing memos begin doing exactly what they were written to do, and B's cost drops with it.

### D. Assembly helpers — not a problem, leave them

`collectGroups` and `wrapRow` (`chat-stream.tsx`), `renderCode` and `renderPdf` (`file-viewer.tsx`), `renderTriggerIcon` (`update-status-indicator.tsx`), `createColumns` (`tasks-data-table/columns.tsx`).

These are called from inside compiled components, and their results are cached as part of the enclosing block. They wrap or arrange nodes rather than being rendered as component types, so React never treats them as components and nothing is lost by their casing. Renaming them would misrepresent what they are.

## Order

1. **A**, on its own. Mechanical, no behaviour change, no measurement needed.
2. **C**, measured. Fixing timestamp identity is the single change that makes four existing memos start working; do it before B, because it may make B unnecessary.
3. **B**, only if measurement after C still shows the transcript rebuilding more than it needs to.

## Guardrails

The test suite now compiles components the way the app ships them (`vitest.config.ts`), so a render test can observe caching. Without that, the two bugs behind this plan both passed a green suite.

What the suite still cannot catch is category 2: a lowercase function that should be a component is not *wrong*, just unoptimised, and no assertion fails. A lint rule is the natural home for it — something that flags a function typed as a component (`Components["x"]`, or any function returning JSX passed where a component type is expected) whose name does not start with a capital. Worth checking whether `eslint-plugin-react-hooks`'s compiler-aware rules already cover this before writing one.
