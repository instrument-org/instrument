// Builds the two bundles this skill carries, from a checkout of the internal
// repo, which holds the recorder and the replay library they are made of:
//
//   capture.js   the recorder's page capture, loaded into Studio's renderer
//   player.js    the replay and everything drawn over it (window.Walkthrough)
//   player.css
//
//   node vendor/build.mjs <internal checkout>
//
// The capture needs the recorder's `maskInputs` option, so a scripted take's
// typing is recorded as typed.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [internal] = process.argv.slice(2);
if (!internal) {
  console.error("usage: node vendor/build.mjs <internal checkout>");
  process.exit(1);
}
const pages = path.join(path.resolve(internal), "apps/pages");
const { build } = await import(
  path.join(pages, "node_modules/esbuild/lib/main.js")
);
const common = {
  bundle: true,
  format: "iife",
  legalComments: "none",
  minify: true,
  nodePaths: [path.join(pages, "node_modules")],
  target: "chrome130",
  write: false,
};

const capture = await build({
  ...common,
  entryPoints: [path.join(HERE, "../player/capture-entry.ts")],
  outfile: "capture.js",
});
writeFileSync(path.join(HERE, "capture.js"), capture.outputFiles[0].text);

const player = await build({
  ...common,
  entryPoints: [path.join(HERE, "../player/index.js")],
  loader: { ".css": "css" },
  outdir: HERE,
});
for (const file of player.outputFiles) {
  writeFileSync(
    path.join(HERE, file.path.endsWith(".css") ? "player.css" : "player.js"),
    file.text,
  );
}
console.log("capture.js, player.js, player.css");
