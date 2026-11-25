# Maintaining the Studio wireframe kit

The kit is meant to be edited by whoever draws with it. This is how to keep it true to the app. `RAW=3` or `RAW=all` on `build.mjs` also writes frames alone at true size to the temp folder, and a part written as a JS file with `META` and `states` builds as one of frames does.

## Measuring against the app

A baseline frame that names a state of the running app in `measure` is checked against it. [`measure/measure.mjs`](measure/measure.mjs) takes a picture of every baseline frame at true size, has [`measure/capture.mjs`](measure/capture.mjs) put a booted Studio into each named state and take a picture at the same 1280x800, 1x and light theme (with what only a developer sees in the bar hidden), and writes `compare.html`, each frame laid over the app with a slider between them, so drift shows up as a ghost:

```bash
DRIVE=.agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs
node $DRIVE boot --purpose "kit measure" --workspace documents
node .agents/wireframe-kit/measure/measure.mjs ~/wireframes/kit-measure          # everything, about a minute and a half
node .agents/wireframe-kit/measure/measure.mjs ~/wireframes/kit-measure --only files-table,files-list
node .agents/wireframe-kit/measure/measure.mjs ~/wireframes/kit-measure --no-app  # retake only the kit's pictures
node $DRIVE stop --workspace documents
```

It writes the Instrument folder Files is shown on into the output folder, files the fixture's chat under Pricing, and leaves the app's theme as it found it. `--only` writes a `compare.html` of just those states. A state the app cannot reach in a fixture (the release notes need the API) has no `measure` and is checked by reading the code it names. The same goes for a measure run's pictures as for wireframes: they live outside the repository.

## Changing the kit

- **When a round draws a surface the kit lacks**, or corrects one it draws wrong, move that piece into the kit file for its surface as a function, add a frame for it to `baseline.js` (with a `measure` key and a state in `capture.mjs` when the app can reach it), rebuild the baseline, and list it in [`REFERENCE.md`](REFERENCE.md).
- **When the app changes, measure** (above) rather than patching from memory, then correct the kit until the ghosts go away. Each file's header says when it was last measured.
- **A new file** goes in `kit/` and in `KIT_FILES` in [`kit.mjs`](kit.mjs), after the files whose top-level values it uses. [`kit/pieces.js`](kit/pieces.js) is not in `KIT_FILES`: only a part of frames loads it, after the skill's pieces.
- **Names in a JS part are global.** A JS part (`META` and `states`) shares one scope with the kit, so a part that defines a name the kit has fails the build with that name, and the template's own top-level names (`layout`, `stage`, `step`, `views`, `more`, `rack`, `shortcut`) are caught by the build's compile check. A part of frames may shadow any of them.

Not in the kit yet, so drawn by hand when a round needs it: an app's own page and a task opened on its own.
