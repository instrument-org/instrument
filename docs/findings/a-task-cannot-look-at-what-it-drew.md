# A task cannot look at what it drew

**Status:** measured 2026-09-07 across four models on five visual deliverables. Three of the four tried to open their own finished page or drawing and were stopped by the same error. One of them found a way through after six failed attempts. The eval harness is where this was found and where the fix belongs; whether the packaged app has the same gap is untested and stated as such below.

## What happens

A task writes `output/compare.html`, then does the thing the prompt asks of it — open the result the way the user will see it — and gets:

```
$ agent-browser open output/compare.html
✗ Failed to deserialize CDP response for Page.navigate: missing field `frameId`
```

Every following command fails the same way:

```
$ agent-browser get text body
✗ Failed to deserialize CDP response for Runtime.evaluate: missing field `result`
```

The command exists, the skill loads, the binary runs, and the first navigation fails with a protocol error that says nothing about what is actually wrong. `agent-browser` outside the workspace, driving a browser it launches itself, opens the same file and reads it back without complaint.

## Why

`agent-browser` is pointed at the workspace's own CDP bridge rather than at a browser of its own: `shell-commands/agent-browser.ts` registers the Instrument provider plugin with a `ws://` URL into `routes/cdp-bridge.ts`, which forwards every command to `workspaceConfig.browser.sendCommand`. In the eval harness that is `createStubBrowserConfig` (`src/test/helpers/mock-task-config.ts`), whose `sendCommand` resolves `{}` for every method. `Page.navigate` is answered with an empty object, `agent-browser`'s Rust client requires `frameId` on that response, and it errors.

So this is a harness gap, not a product defect: in the app the bridge is backed by a real webview.

A task opening its own file by path is fine, and the wrapper is what makes it fine. `agent-browser open output/page.html` comes back as

```
✓ http://assets.2026-09-07-write-a-file-page-html-in-your-output.localhost:48500/output/page.html
```

— the command rewrites a task-relative path onto the per-task asset origin before the browser sees it, so the model never has to know the origin exists. That translation is in the shared wrapper rather than anywhere eval-specific, so the same call should work in the app; that has not been run against a packaged build.

## Why it matters more than it looks

Design is the axis the models separate on, and design defects are only visible as pixels. Measured over the round: every model passed every structural check, and the pages still shipped with an arrowhead sitting on top of a label, a callout overlapping an axis, and a stray full stop orphaned on its own line. Those are exactly the defects a render catches and a read of the source does not.

The self-check assertion in `evals/cases/worker.ts` scores whether a task read its deliverable back. Over the five cases here, three of four models "looked" most of the time and only one in five looks was a render. That number has been measuring an affordance the harness withholds, not a habit the model lacks.

## What one model did about it

GLM 5.3 Flash, on the octopus drawing, spent six of thirteen tool calls trying to see its own SVG:

1. `agent-browser open` then `screenshot` — the CDP error above.
2. The same command again — the same error.
3. `pnpm add sharp` — `pnpm` cannot run in the task sandbox, so no `node_modules`.
4. `pnpm add sharp` again with output shown, then a `require` probe, then an inspection of `package.json` — all confirming the same thing.
5. Loaded the `sharp-images` skill hoping for a preinstalled `sharp`.
6. `pip install resvg-py`, rasterized the SVG to a PNG, and read the PNG back with the file tool, which is the one path that put pixels in front of it.

That last line is the whole workaround, and it took a model six failures to find. The two paid models in the same round tried the browser once and moved on.

## The fix, and what it changed

`BrowserConfig` gained `hasNoWindow`, which only the eval harness sets. Where it is set, `agent-browser` is left without the Instrument provider plugin and starts a browser of its own, which it does correctly. Nothing about the app path moves.

The check that it works is also the check that matters: asked to write a page and read its heading back, the same model that could not navigate before now opens the file, gets the asset URL above, and reports the heading.

Two things the working loop showed immediately, both on GLM 5.3 Flash and neither visible before:

- Given sight of its own drawing, it **changes it**. On the octopus it rendered the SVG, read the PNG, moved the center pin, re-rendered, and looked again. That is the whole self-check loop, and it had never once completed in any earlier round.
- Rasterizing is still a scavenger hunt. `pnpm add sharp` cannot run in the task sandbox and the `sharp-images` skill's copy is not reachable either, so the only route that works is `pip install resvg-py`. Every model that wants to see an SVG pays several failed calls to find it.

So the remaining product question is not whether a task can open a page — it can — but whether it has any supported way to turn a drawing or a document into pixels. Today it does not, and the models are finding one by trial.
