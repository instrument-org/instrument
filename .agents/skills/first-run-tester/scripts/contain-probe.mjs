#!/usr/bin/env node
// Containment probe: asks the app's own main process, over its inspector, to
// do to the canaries in the real home what a run must never manage. Each line
// should say it was refused.
//
//   node contain-probe.mjs --inspect 9377
import os from "node:os";
import { checkAndClear, plant } from "./lib/canaries.mjs";
import { connect } from "./lib/screen.mjs";

plant();

const port = process.argv[process.argv.indexOf("--inspect") + 1];
const home = os.userInfo().homedir;
const [target] = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const cdp = await connect(target.webSocketDebuggerUrl);
const expression = `(async () => {
  const require = process.getBuiltinModule("node:module").createRequire(process.execPath);
  const fs = require("node:fs");
  const cp = require("node:child_process");
  const electron = require("electron");
  const home = ${JSON.stringify(home)};
  const file = home + "/frt-canary.txt";
  const folder = home + "/frt-canary-folder";
  const out = {};
  const attempt = async (name, fn) => {
    try { out[name] = "DID IT: " + String(await fn()).slice(0, 80); }
    catch (error) { out[name] = "refused: " + (error.code ?? error.message).toString().slice(0, 120); }
  };
  await attempt("the app's home folder is", () => { const h = require("node:os").homedir(); if (h === home) return h; throw new Error("not the real one: " + h); });
  await attempt("list real home", () => fs.readdirSync(home).length + " entries");
  await attempt("read canary file", () => fs.readFileSync(file, "utf8"));
  await attempt("list canary folder", () => fs.readdirSync(folder));
  await attempt("rename canary file", () => fs.renameSync(file, file + ".renamed"));
  await attempt("rename canary folder", () => fs.renameSync(folder, folder + "-renamed"));
  await attempt("overwrite canary file", () => fs.writeFileSync(file, "changed"));
  await attempt("delete canary file", () => fs.unlinkSync(file));
  await attempt("create file in real home", () => fs.writeFileSync(home + "/frt-created.txt", "x"));
  await attempt("create file on real Desktop", () => fs.writeFileSync(home + "/Desktop/frt-created.txt", "x"));
  await attempt("trash canary file (Electron)", () => electron.shell.trashItem(file));
  await attempt("trash canary folder (Electron)", () => electron.shell.trashItem(folder));
  await attempt("copy canary into the sandbox (cp)", () => cp.execFileSync("/bin/cp", [file, process.env.TMPDIR + "leak.txt"], { stdio: "pipe" }));
  await attempt("cat canary (child process)", () => cp.execFileSync("/bin/cat", [file], { stdio: "pipe" }));
  await attempt("mv canary (child process)", () => cp.execFileSync("/bin/mv", [file, file + ".mv"], { stdio: "pipe" }));
  await attempt("Finder moves canary to Trash (osascript)", () => cp.execFileSync("/usr/bin/osascript", ["-e", 'tell application "Finder" to delete POSIX file "' + file + '"'], { stdio: "pipe", timeout: 15000 }));
  await attempt("open canary in its default app (open)", () => cp.execFileSync("/usr/bin/open", ["-g", file], { stdio: "pipe", timeout: 15000 }));
  await attempt("open a web page in the real browser (open)", () => cp.execFileSync("/usr/bin/open", ["-g", "https://example.com/frt-probe"], { stdio: "pipe", timeout: 15000 }));
  const reach = (socket) => new Promise((resolve, reject) => {
    if (!socket) return reject(new Error("no such socket on this Mac"));
    const client = require("node:net").connect(socket);
    client.on("connect", () => { client.destroy(); resolve("connected"); });
    client.on("error", reject);
  });
  await attempt("connect to the SSH agent's socket", () => reach(${JSON.stringify(process.env.SSH_AUTH_SOCK ?? "")}));
  // CONTAIN_PROBE_SOCKET names another app's Unix socket to try, such as a terminal's control socket.
  await attempt("connect to another app's control socket", () => reach(${JSON.stringify(process.env.CONTAIN_PROBE_SOCKET ?? "")}));
  await attempt("see this shell's tokens in the environment", () => { const names = Object.keys(process.env).filter((name) => /TOKEN|SECRET|KEY|SSH_AUTH|CLAUDE/.test(name)); if (names.length) return names.join(","); throw new Error("none there"); });
  await attempt("read real ~/.ssh", () => fs.readdirSync(home + "/.ssh").length + " entries");
  await attempt("read real Documents", () => fs.readdirSync(home + "/Documents").length + " entries");
  await attempt("read /Volumes", () => fs.readdirSync("/Volumes"));
  await attempt("write inside the stand-in home (should work)", () => { fs.writeFileSync(require("node:os").homedir() + "/Documents/probe-ok.txt", "ok"); fs.unlinkSync(require("node:os").homedir() + "/Documents/probe-ok.txt"); return "ok"; });
  return out;
})()`;
const { result, exceptionDetails } = await cdp.send(
  "Runtime.evaluate",
  { awaitPromise: true, expression, returnByValue: true },
  90_000,
);
cdp.close();
if (exceptionDetails) {
  console.error(exceptionDetails.exception?.description);
  checkAndClear();
  process.exit(1);
}
let leaked = 0;
for (const [name, outcome] of Object.entries(result.value)) {
  const expectedToWork = name.includes("should work");
  const bad = outcome.startsWith("DID IT") !== expectedToWork;
  leaked += bad ? 1 : 0;
  console.log(`${bad ? "LEAK" : "ok  "}  ${name}: ${outcome}`);
}
for (const change of checkAndClear()) {
  leaked += 1;
  console.log(`LEAK  ${change}`);
}
console.log(leaked ? `${leaked} LEAKS` : "contained");
process.exit(leaked ? 1 : 0);
