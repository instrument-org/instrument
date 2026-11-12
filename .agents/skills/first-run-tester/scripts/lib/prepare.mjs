// What the harness sets in the app before the tester starts, through the
// renderer's own RPC client (the page is a dev server's, so the module can be
// imported by its address). Nothing here is visible to the tester.

import { connect } from "./screen.mjs";

/**
 * Turns on the app's own switch for running its agent's programs with no
 * sandbox of the app's. The whole app runs inside the harness's Seatbelt
 * profile, and macOS refuses a second Seatbelt inside one, so without this
 * the agent could run no program at all. The outer profile still holds them.
 */
export async function allowProgramsUnderOuterSandbox({ port, version }) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((target) => target.type === "page");
  const cdp = await connect(page.webSocketDebuggerUrl);
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    awaitPromise: true,
    expression: `(async () => {
      const url = performance.getEntriesByType("resource").map((entry) => entry.name)
        .find((name) => /\\/client\\/rpc\\/client\\.ts/.test(name)) ?? "/client/rpc/client.ts";
      const { rpcClient } = await import(url);
      await rpcClient.preferences.setRunProgramsWithoutSandbox.call({ enabled: true });
      // The app's notice about that switch, which a person on a real Mac
      // would never have: closed in each state it can be in, so the bell
      // starts without it.
      for (const off of ["did-not-start", "no-seatbelt"]) {
        for (const choice of ["allowed", "refused"]) {
          await rpcClient.notices.dismiss.call({ id: \`sandbox-off-\${off}-\${choice}-${version}\` });
        }
      }
      return "ok";
    })()`,
    returnByValue: true,
  });
  cdp.close();
  if (exceptionDetails || result.value !== "ok") {
    throw new Error(
      `Could not set the preference: ${exceptionDetails?.exception?.description ?? JSON.stringify(result)}`,
    );
  }
}
