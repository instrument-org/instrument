/**
 * What the installed agent-browser CLI prints, recorded once per release into
 * `agent-browser-cli-output.generated.ts` so the tests that read it run no
 * binary and no browser. `script:record-agent-browser-output` writes it, and a
 * test fails until it has been run again after moving to a new release.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** A page with every kind of select and listbox the fold decides about. */
const SNAPSHOT_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Snapshot fold fixture</title>
  </head>
  <body>
    <nav aria-label="Primary">
      <a href="#orders">Orders</a>
    </nav>
    <h1>Order a shirt</h1>
    <label for="size">Size</label>
    <select id="size">
      <option>Small</option>
      <option selected>Medium</option>
      <option disabled>Large, tall</option>
      <option value="xl">Extra "wide" [XL]</option>
    </select>
    <label for="qty">Quantity</label>
    <select id="qty">
      <optgroup label="Few"><option>1</option><option>2</option></optgroup>
      <optgroup label="Many"><option>10</option><option>20</option><option>50</option></optgroup>
    </select>
    <select aria-label="Plan">
      <option value="">Choose</option>
      <option value="a">Monthly</option>
      <option value="b">Monthly</option>
      <option>Yearly</option>
      <option>Every two years</option>
    </select>
    <select aria-label="Gift"><option>No</option><option>Yes</option></select>
    <select aria-label="Sizes in stock" multiple>
      <option>S</option>
      <option selected>M</option>
    </select>
    <div role="combobox" tabindex="0" aria-label="Fit" aria-expanded="false" aria-controls="fits">Regular</div>
    <div role="combobox" tabindex="0" aria-label="Sleeve" aria-expanded="true" aria-owns="sleeves">Long</div>
    <ul id="sleeves" role="listbox" aria-label="Sleeve lengths">
      <li role="option" aria-selected="true" tabindex="-1">Long</li>
      <li role="option" tabindex="-1">Short</li>
    </ul>
    <ul role="listbox" aria-label="Gift wrap">
      <li role="option" aria-selected="true" tabindex="0">None</li>
      <li role="option" tabindex="-1">Paper</li>
    </ul>
    <label for="note">Note</label>
    <textarea id="note">Leave it at the door</textarea>
    <button type="button">Add to cart</button>
  </body>
</html>
`;

/** The option of `#size` chosen by the name its folded line prints. */
export const SELECTED_OPTION_NAME = 'Extra "wide" [XL]';

/** A value whose later lines read as controls, one of them with a ref of the page's. */
export const MULTI_LINE_VALUE = [
  "Shopping:",
  "- milk",
  '- combobox "Pasted" [expanded=false, ref=e2]',
  '  - option "One" [ref=e9001]',
].join("\n");

/** The commands that name a file, whose own flags the wrapper reads from their help. */
const FILE_COMMANDS = [
  "screenshot",
  "pdf",
  "download",
  "trace",
  "profiler",
  "record",
  "network",
] as const;

export type FileCommand = (typeof FILE_COMMANDS)[number];

interface CliRecording {
  commandHelp: Record<FileCommand, string>;
  help: string;
  multiLineSnapshot: string;
  selectedValue: string;
  snapshot: string;
  version: string;
}

/** Runs the CLI at `binary` against `SNAPSHOT_PAGE` and its help, and closes the browser it opened. */
export function recordAgentBrowserOutput(
  binary: string,
  version: string,
): CliRecording {
  const read = (args: string[]) =>
    execFileSync(binary, args, { encoding: "utf8", timeout: 30_000 });
  const help = read(["--help"]);
  const commandHelp = Object.fromEntries(
    FILE_COMMANDS.map((command) => [command, read([command, "--help"])]),
  ) as CliRecording["commandHelp"]; // fromEntries types its keys as string.

  const session = `record-agent-browser-output-${process.pid}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-browser-output-"));
  const run = (...args: string[]) =>
    execFileSync(binary, ["--session", session, ...args], {
      encoding: "utf8",
      env: { ...process.env, AGENT_BROWSER_IDLE_TIMEOUT_MS: "60000" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
  try {
    const page = path.join(dir, "page.html");
    fs.writeFileSync(page, SNAPSHOT_PAGE);
    run("open", pathToFileURL(page).href);
    const snapshot = run("snapshot", "-i").trimEnd();
    run("select", "@e3", SELECTED_OPTION_NAME);
    const selectedValue = run("get", "value", "@e3").trim();
    run(
      "eval",
      `document.querySelector("#note").value = ${JSON.stringify(MULTI_LINE_VALUE)}; 1`,
    );
    const multiLineSnapshot = run("snapshot", "-i").trimEnd();
    return {
      commandHelp,
      help,
      multiLineSnapshot,
      selectedValue,
      snapshot,
      version,
    };
  } finally {
    try {
      run("close");
    } catch {
      // The browser never opened.
    }
    fs.rmSync(dir, { force: true, recursive: true });
  }
}

/** The generated module's text for a recording. */
export function generatedRecordingModule(recording: CliRecording): string {
  return [
    "// Generated by scripts/record-agent-browser-output.ts from the installed",
    "// agent-browser release. Do not edit; run the script.",
    "",
    `export const AGENT_BROWSER_OUTPUT_RECORDED_FROM = ${JSON.stringify(recording.version)};`,
    "",
    `export const AGENT_BROWSER_HELP = ${JSON.stringify(recording.help)};`,
    "",
    `export const AGENT_BROWSER_COMMAND_HELP = ${JSON.stringify(recording.commandHelp, null, 2)};`,
    "",
    `export const AGENT_BROWSER_SNAPSHOT = ${JSON.stringify(recording.snapshot)};`,
    "",
    `export const AGENT_BROWSER_SELECTED_VALUE = ${JSON.stringify(recording.selectedValue)};`,
    "",
    `export const AGENT_BROWSER_MULTI_LINE_SNAPSHOT = ${JSON.stringify(recording.multiLineSnapshot)};`,
    "",
  ].join("\n");
}
