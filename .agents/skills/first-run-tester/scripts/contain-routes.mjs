#!/usr/bin/env node
// Containment probe, one layer up from contain-probe.mjs: calls the app's own
// routes, the ones its Files screen calls for Rename and Move to Trash, on
// the canaries in the real home, through the renderer's RPC client.
//
//   node contain-routes.mjs --port 48278
import os from "node:os";
import { checkAndClear, plant } from "./lib/canaries.mjs";
import { connect } from "./lib/screen.mjs";

plant();

const port = process.argv[process.argv.indexOf("--port") + 1];
const home = os.userInfo().homedir;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const cdp = await connect(list.find((target) => target.type === "page").webSocketDebuggerUrl);
const { result, exceptionDetails } = await cdp.send(
  "Runtime.evaluate",
  {
    awaitPromise: true,
    expression: `(async () => {
      const url = performance.getEntriesByType("resource").map((entry) => entry.name)
        .find((name) => /\\/client\\/rpc\\/client\\.ts/.test(name)) ?? "/client/rpc/client.ts";
      const { rpcClient } = await import(url);
      const home = ${JSON.stringify(home)};
      const out = {};
      const attempt = async (name, fn) => {
        try { out[name] = "DID IT: " + JSON.stringify(await fn()).slice(0, 100); }
        catch (error) { out[name] = "refused: " + String(error?.message ?? error).slice(0, 140); }
      };
      await attempt("files.rename canary file", () => rpcClient.files.rename.call({ name: "frt-renamed.txt", path: home + "/frt-canary.txt" }));
      await attempt("files.rename canary folder", () => rpcClient.files.rename.call({ name: "frt-renamed-folder", path: home + "/frt-canary-folder" }));
      await attempt("files.trash canary file", () => rpcClient.files.trash.call({ path: home + "/frt-canary.txt" }));
      await attempt("files.trash canary folder", () => rpcClient.files.trash.call({ path: home + "/frt-canary-folder" }));
      return out;
    })()`,
    returnByValue: true,
  },
  60_000,
);
cdp.close();
if (exceptionDetails) {
  console.error(exceptionDetails.exception?.description);
  checkAndClear();
  process.exit(1);
}
let leaked = 0;
for (const [name, outcome] of Object.entries(result.value)) {
  leaked += outcome.startsWith("DID IT") ? 1 : 0;
  console.log(`${outcome.startsWith("DID IT") ? "LEAK" : "ok  "}  ${name}: ${outcome}`);
}
for (const change of checkAndClear()) {
  leaked += 1;
  console.log(`LEAK  ${change}`);
}
console.log(leaked ? `${leaked} LEAKS` : "contained");
process.exit(leaked ? 1 : 0);
