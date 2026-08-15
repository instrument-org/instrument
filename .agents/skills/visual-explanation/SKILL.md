---
name: visual-explanation
description: Create a tailored, single-file HTML visual explanation of a complex question, code change, architecture, plan, incident, comparison, workflow, or product behavior. Use when the user asks to visualize work, make something easier to understand, explain changes visually, produce an interactive technical artifact, or invokes this skill for a richer answer than prose alone.
---

# Visual explanation

Create one HTML artifact whose form follows the question. This is a flexible explanatory canvas, not a fixed report, wireframe, slide deck, or exhaustive diff viewer.

## Make the artifact

1. Identify the exact thing the reader is trying to understand or decide. Use context and evidence already available in the task, inspecting only the additional source needed to avoid guessing.
2. Copy `template.html` to `docs/visual-explanations/YYYY-MM-DD-<topic>.html` under the repository root without reading or rebuilding its theme shell. Create the directory when needed. Honor a different path only when it is also inside the repository.
3. Copy the template rather than writing the file; two thirds of it is a theme block a script maintains, and the tab title and favicon derive from the `h1`. Replace the placeholder body with the clearest visual answer you can make. Choose any combination of causal chain, system map, sequence, lifecycle, timeline, before/after comparison, annotated UI, decision matrix, focused diff, evidence view, worked example, or another form better suited to the subject. The tab title is derived from the `h1`, so write a real one and leave the `<title>` placeholder alone.
4. Return a direct link to the HTML file and a one-sentence description of what it explains.

## Keep the latitude

There are no required sections, length, navigation, number of panels, or interactions. Do not automatically add background, a table of contents, a quiz, metrics, or a file-by-file walkthrough. Lead with the answer and prefer selective depth over exhaustive coverage.

For code changes, establish the relevant scope and distinguish implemented behavior from plans or open questions, but do not turn artifact creation into a separate code review or audit. Use focused code or diff excerpts only when exact syntax matters.

Label inference as inference. If evidence is incomplete or contradictory, show that uncertainty rather than smoothing it away.

The template provides Tailwind v4, Studio's light-theme colors, Work Sans, JetBrains Mono, Phosphor icons, and a minimal responsive shell. Use ordinary Tailwind utilities and edit freely. When depicting Studio UI, read `../product-wireframe/SKILL.md` for source-backed product details. Use HTML and CSS for layout, inline SVG when geometry matters, and small local JavaScript only when interaction materially helps. Do not use ASCII diagrams.

## When the artifact is one of a series

A design conversation often wants several artifacts, one per round, each a new file rather than an edit to the last. A few things earn their place in that mode and nowhere else:

- **Open with a settled-versus-cut ledger.** A compact grid of what is now decided and what has been dropped, so the reader confirms the shared state before reading the argument. It replaces recapping the previous artifact in prose.
- **Say plainly when you are reversing your own earlier recommendation, and on what new information.** A revision that quietly changes position makes the reader re-derive which version they are holding.
- **Calibrate against a real reference implementation** when one exists, and verify rather than recall it. Comparing against how a known product actually behaves is usually more decisive than reasoning from first principles, and it can turn out to support the opposite conclusion.
- **Keep the open questions last and shrinking.** Lead with the answer while the design is still moving; once it has converged, a short list of what is genuinely undecided is the most useful ending.
- **Add a section for what the reader said they might be forgetting**, when they say so. Adjacent consequences they have not asked about are often the highest-value part of a late round.

## Hand off quickly

Treat the artifact as a single-use visual answer for the human reading it now. `docs/visual-explanations/` is gitignored, so these are not history and nothing has to be pruned; if one should outlive the conversation, the user will ask for it to be committed or for its content to move into a durable doc under `docs/`. Open it when it is written (`open <path>` on macOS) so it is on screen rather than waiting to be found. Beyond that, do not take screenshots, test multiple widths, run theme synchronization, audit the content, or iterate on visual details unless the user explicitly asks or the creation step reported a concrete error. Do not knowingly include secrets or private operational data.

The theme synchronizer is maintenance tooling for changes to the template or Studio theme, not part of ordinary artifact creation:

```bash
node .agents/skills/product-wireframe/scripts/sync-theme.ts --check
```
