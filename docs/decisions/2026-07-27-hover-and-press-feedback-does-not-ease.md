# Hover and press feedback does not ease

## Context

Tailwind's `transition-colors` and `transition-all` carry a 150ms ramp by default. On the web that reads as polish. In a desktop app it reads as lag: the OS chrome around the window repaints a hover state on the next frame, and a control that fades into its hover state over 150ms feels a beat behind everything beside it.

Once controls activate on pointer press (see [controls activate on press](./2026-07-27-controls-activate-on-press.md)), an easing ramp is worse than cosmetic. The action has already run by the time the ramp starts, so the animation sits in front of the confirmation of something that already happened. Making activation instant and leaving the feedback eased spends the win and keeps the symptom.

## Decision

**Color and background never ease. Outline, shadow and transform may.**

Instant feedback comes from the _absence_ of a transition class, so a control with no `transition-*` is a control whose hover and pressed states land on the next paint. A transition class that is present means something genuinely moves, and it means what Tailwind says it means.

Motion keeps its ramp: a switch thumb sliding, a disclosure caret rotating beside a panel that animates open, the sidebar collapsing, a progress fill. Those either rely on Tailwind's real 150ms default or name an explicit `duration-*`.

Where a single animation combines a background with a shape change, the properties stay together rather than being split. The tab chip morphs `background-color`, `border-radius` and `box-shadow` as one gesture when it becomes selected; easing two of the three would desync the corner from the fill.

## Why this is not encoded as a global default

Tailwind v4 exposes `--default-transition-duration`, and setting it to `0s` in the theme achieves the same visual result in one line. That was tried and reverted deliberately.

The problem is that it does not remove the transitions, it silently disarms them. Seventy-seven `transition-colors` and `transition-all` classes stayed in the codebase reading like working code while doing nothing at all. Anyone who knows Tailwind, and any agent trained on it, would be wrong about what those lines do, and would only find out by reading a theme file they had no reason to open. Debugging "why is my transition not running" against an invisible global override is a bad afternoon.

A one-line config that makes seventy-seven lines lie is a worse trade than deleting seventy-seven lines. So the classes are gone instead, and the rule is legible from any single line without outside knowledge.

The same reasoning rules out a global stylesheet override that zeroes durations by selector: it would redefine a well-known utility from a distance, and it could not tell hover feedback apart from motion on the same element.

## Consequences

- Adding `transition-colors` is a lint error (`no-restricted-syntax` in the Studio ESLint config), pointing at the alternatives. This is the part that keeps the sweep from decaying, since nothing else would stop a new component from reintroducing a ramp.
- `transition-all` is deliberately **not** banned. It still carries real motion on the progress fill and the switch, where it animates transform and layout rather than feedback.
- A transition utility with no `duration-*` is not a bug. It uses Tailwind's genuine 150ms default, which is what a reader expects.
- Focus rings still ease. They appear on keyboard focus, have nothing to do with click latency, and a hard-snapping ring is harsher than a fading one.
- Hover-revealed controls fade in only where they set an explicit duration. Bare `transition-opacity` reveals were removed, so a control that appears under the pointer appears at once.

## Implementation

- [Shared toggle and toolbar chrome, where only the outline eases](../../apps/studio/src/client/components/ui/toggle.tsx)
- [Button, narrowed from `transition-all`](../../apps/studio/src/client/components/ui/button.tsx)
- [The lint rule that rejects `transition-colors`](../../apps/studio/eslint.config.ts)
