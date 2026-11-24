#!/usr/bin/env node
// Stands in for the model when checking the runner: it does nothing, and
// after three seconds leaves the file the tool server leaves when the rig
// fails. The runner should end it at once and write its result line.
import { writeFileSync } from "node:fs";
import path from "node:path";

const runDir = process.argv[2];
console.log(JSON.stringify({ subtype: "init", type: "system" }));
setTimeout(() => {
  writeFileSync(
    path.join(runDir, "rig-failed.json"),
    `${JSON.stringify({ error: "pretend failure", step: 1 })}\n`,
  );
}, 3000);
setInterval(() => {}, 1000);
