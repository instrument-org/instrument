// The words, checked against a real instance: boots one of its own off
// screen (documents fixture, rebuilt fresh), runs each check in order with a
// hard time limit, prints one line per check, and stops the instance.
// On demand, not in CI: it takes about a minute once booted.
//
//   node .agents/skills/studio-chrome-devtools/scripts/drive/suite.mjs [--keep] [--only <name>]
//
// --keep leaves the instance running for a look afterward (stop it with
// `studio-drive.mjs stop --workspace documents --as words-suite`).

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connect } from "../studio-app.mjs";
import { createWords } from "./words.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DRIVE = path.join(here, "..", "studio-drive.mjs");
const FLAGS = ["--workspace", "documents", "--as", "words-suite"];
const CHECK_MS = 60_000;
const keep = process.argv.includes("--keep");
const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1]
  : undefined;

const scratch = path.join(tmpdir(), "instrument-studio-drive", "suite");
rmSync(scratch, { force: true, recursive: true });
mkdirSync(scratch, { recursive: true });
const csv = path.join(scratch, "budget.csv");
writeFileSync(csv, "month,amount\nJanuary,10\n");

/** A page of its own on loopback, so no check depends on the network. */
const site = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(
    request.url === "/next"
      ? "<title>Next page</title><h1>Arrived</h1>"
      : `<title>Suite page</title><h1>Suite page</h1>
         <label>Note <input aria-label="Note"></label>
         <button onclick="document.querySelector('h1').textContent = 'Pressed'">Press me</button>
         <a href="/next">Onward</a>`,
  );
});
await new Promise((resolve) => {
  site.listen(0, "127.0.0.1", resolve);
});
const siteURL = `http://127.0.0.1:${site.address().port}/`;

const assert = (value, message) => {
  if (!value) {
    throw new Error(`Expected ${message}`);
  }
};

const checks = [
  ["state names the window", async (w) => {
    const text = await w.state();
    assert(text.includes("groups:") && text.includes('textbox "Talk to Instrument"'), `the summary and the composer in:\n${text}`);
  }],
  ["press opens a tab, tab().close() closes it", async (w) => {
    const before = (await w.tabs()).length;
    await w.press("Meta+t");
    assert((await w.tabs()).length === before + 1, "one more tab after Meta+t");
    await w.tab().close();
    assert((await w.tabs()).length === before, "the tab closed");
  }],
  ["menu bar items split and join a group", async (w) => {
    await w.menu("New Tab in Split");
    assert(await w.side("right").exists(), "a right side");
    await w.side("right").button("Close Split").click();
    assert(!(await w.side("right").exists()), "the split closed");
  }],
  ["composer types, reads and clears", async (w) => {
    await w.composer.type("draft words");
    assert((await w.composer.text()).includes("draft words"), "the typed words in the composer");
    await w.composer.clear();
    assert(!(await w.composer.text()).trim(), "an empty composer");
  }],
  ["paste leaves the clipboard alone", async (w) => {
    await w.composer.click();
    await w.paste("pasted words");
    assert((await w.composer.text()).includes("pasted words"), "the pasted words");
    await w.composer.clear();
  }],
  ["command menu searches and opens a chat", async (w) => {
    await w.commandMenu.search("Red and blue");
    const rows = await w.commandMenu.rows();
    assert(rows.some((row) => row.includes("Red and blue squares PDF")), `the chat among ${rows.join(" | ")}`);
    await w.commandMenu.pick("Red and blue squares PDF");
    assert((await w.chat().id()) === "red-and-blue-squares", "the chat up");
  }],
  ["a group's row and a tab's menu read and close", async (w) => {
    const groupItems = await w.group("Red and blue squares PDF").menu();
    assert(groupItems.length > 2, `items in the group's menu: ${groupItems}`);
    await w.press("Meta+t");
    const tabItems = await w.tab().menu();
    assert(tabItems.some((item) => /^Close/.test(item)), `Close in the tab's menu: ${tabItems}`);
  }],
  ["settings open and a switch flips back", async (w) => {
    await w.settings.open();
    await w.see("General");
    const toggle = w.find("switch").nth(0);
    const was = await toggle.isOn();
    await toggle.click();
    assert((await toggle.isOn()) !== was, "the switch flipped");
    await toggle.click();
    assert((await toggle.isOn()) === was, "the switch back");
    await w.tab().close();
  }],
  ["a page's file picker and a folder picker are answered", async (w) => {
    await w.press("Meta+t");
    await w.composer.button("Add to this prompt").click();
    await w.menu("Attach files");
    assert(await w.dialog.isOpen(), "the file picker held");
    await w.dialog.choose(csv);
    await w.see("budget.csv");
    await w.composer.button("Add to this prompt").click();
    await w.menu("Add a folder");
    assert((await w.dialog.text()).includes("Open"), "a system open dialog");
    await w.dialog.cancel();
    assert(!(await w.dialog.isOpen()), "the dialog answered");
    await w.tab().close();
  }],
  ["a web page is clicked, typed into and its menu read", async (w) => {
    await w.press("Meta+t");
    await w.omnibar.go(siteURL);
    const page = w.page();
    await page.see("Suite page");
    await page.click("Press me");
    await page.see("Pressed");
    await page.click("Note");
    await page.type("hi");
    assert((await page.eval("document.querySelector('input').value")) === "hi", "the typed note");
    const items = await page.menu("Onward");
    assert(items.some((item) => item.startsWith("Open Link")), `link items: ${items}`);
    await page.click("Onward");
    await page.see("Arrived");
    assert((await page.url()).endsWith("/next"), "the next page");
    assert((await w.omnibar.text()).includes("/next"), "the omnibar's address");
  }],
  ["a tab is dragged onto another group", async (w) => {
    await w.menu("New Tab Group");
    await w.omnibar.go(siteURL);
    await w.press("Meta+t");
    const other = (await w.groups()).find((group) => !group.isUp);
    const name = other.sides[0].tabs.find((tab) => tab.isUp).title;
    const count = async () => (await w.groups()).find((group) => group.id === other.id).sides.flatMap((side) => side.tabs).length;
    const before = await count();
    const { during } = await w.drag(w.tab("Suite page")).into(w.group(name));
    assert(during?.held?.kind === "tab", `a tab held on the way, got ${JSON.stringify(during)}`);
    assert((await count()) === before + 1, `the tab in "${name}"`);
  }],
  ["files dropped on the composer attach", async (w) => {
    await w.press("Meta+t");
    await w.dropFiles([csv]).on(w.composer);
    await w.see("budget.csv");
    await w.tab().close();
  }],
  ["a stand-in model answers a chat", async (w) => {
    const stub = await w.model.replies(["The stand-in says hello."]);
    await w.press("Meta+t");
    await w.composer.send("Say hello");
    await w.chat().idle();
    await w.see("The stand-in says hello.");
    assert(stub.requests.some((each) => each.kind === "turn"), "an agent turn asked of the stand-in");
  }],
  ["the window's look: theme, size, sidebar, pictures", async (w) => {
    await w.theme("light");
    assert((await w.look()).theme === "light", "the light theme");
    await w.theme("dark");
    const sized = await w.size(1100, 760);
    assert(sized.width === 1100, "the window resized");
    await w.size(1240, 840);
    const edge = await w.sidebar.width(320);
    assert(Math.abs(edge.x - 320) < 12, `the sidebar edge near 320, at ${edge.x}`);
    await w.sidebar.toggle();
    assert(!(await w.sidebar.isOpen()), "the sidebar hidden");
    await w.sidebar.toggle();
    const file = await w.shot(path.join(scratch, "window.png"));
    const part = await w.composer.shot(path.join(scratch, "composer.png"));
    assert(file && part, "both pictures");
    const frames = await w.burst(() => w.press("Meta+t"), { dir: path.join(scratch, "burst"), every: 60 });
    assert(frames.length >= 2, `frames while a tab opened: ${frames.length}`);
  }],
  ["a second window is driven with its own words", async (w) => {
    const before = (await w.windows()).length;
    await w.menu("New Window");
    await w.until(async () => (await w.windows()).length > before, { label: "a second window" });
    const other = await w.window(0);
    const text = await other.state();
    assert(text.includes("groups:"), "the other window's state");
    await other.menu("Close Window");
    await w.until(async () => (await w.windows()).length === before, { label: "back to one window" });
  }],
  ["a miss names what is there instead", async (w) => {
    let message = "";
    try {
      await w.button("Sned").click({ timeout: 300 });
    } catch (error) {
      message = error.message;
    }
    assert(/No button "Sned"/.test(message) && /Nearest: button "Send"/.test(message) && /Picture: /.test(message), `a useful miss, got:\n${message.slice(0, 400)}`);
  }],
];

const run = (args, timeout) =>
  execFileSync(process.execPath, [DRIVE, ...args, ...FLAGS], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  });

let failed = 0;
let ran = 0;
const startedAt = Date.now();
try {
  run(["stop"], 60_000);
  const bootAt = Date.now();
  run(["boot", "--purpose", "words suite", "--fresh"], 300_000);
  console.log(`booted in ${((Date.now() - bootAt) / 1000).toFixed(1)} s`);

  for (const [name, check] of checks) {
    if (only && !name.includes(only)) continue;
    ran++;
    const app = await connect({ workspace: "documents@words-suite" });
    const { begin, end, words } = createWords(app);
    await begin();
    const checkAt = Date.now();
    let outcome = "ok";
    try {
      await Promise.race([
        check(words),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`took over ${CHECK_MS / 1000} s`)), CHECK_MS).unref();
        }),
      ]);
    } catch (error) {
      failed++;
      outcome = `FAILED: ${error.message.split("\n").slice(0, 12).join("\n    ")}`;
    } finally {
      await end();
      app.close();
    }
    console.log(`${outcome === "ok" ? "✓" : "✗"} ${name}  ${((Date.now() - checkAt) / 1000).toFixed(1)} s${outcome === "ok" ? "" : `\n    ${outcome}`}`);
  }
} finally {
  site.close();
  if (!keep) {
    run(["stop"], 60_000);
  }
}
console.log(`${ran - failed} of ${ran} passed in ${((Date.now() - startedAt) / 1000).toFixed(0)} s`);
process.exitCode = failed ? 1 : 0;
