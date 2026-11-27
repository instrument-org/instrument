import { afterEach, describe, expect, it } from "vitest";

import { publisher } from "../../rpc/publisher";
import { forgetApps, seedApp } from "../../test/helpers/seed-app";
import { actionLog } from "../actions/log";
import { listApps, loadApp, readAppGuide } from "./store";
import { grokPlanSignedInHere, grokPlanSwitchedOnHere } from "./x-app";
import { isXApp } from "./x-site";

afterEach(async () => {
  await forgetApps();
});

/** What `act` publishes about apps, in order, and what it answered. */
async function heard<T>(act: () => Promise<T>) {
  const said: unknown[] = [];
  const stops = [
    publisher.subscribe("app.updated", () => said.push("app.updated")),
    publisher.subscribe("app.event", (event) => said.push(event)),
  ];
  const answered = await act();
  for (const stop of stops) {
    stop();
  }
  return { answered, said };
}

describe("an app on X's site", () => {
  it.each([
    ["https://x.com", true],
    ["https://www.x.com/home", true],
    ["https://mobile.x.com", true],
    ["https://twitter.com", true],
    ["https://www.twitter.com", true],
    ["https://mobile.twitter.com/explore", true],
    ["https://ads.x.com", false],
    ["https://developer.x.com", false],
    ["https://api.twitter.com", false],
    ["https://notx.com", false],
  ])("%s is X: %s", (url, isX) => {
    expect(isXApp({ type: "web", url })).toBe(isX);
  });
});

describe("a Grok plan signed in on this computer", () => {
  it("sets up X where the workspace has no app on its site", async () => {
    const { answered, said } = await heard(grokPlanSignedInHere);

    expect(answered).toBe("x");
    expect(said).toEqual(["app.updated"]);
    const app = (await loadApp("x"))._unsafeUnwrap();
    expect({
      guide: await readAppGuide(app.slug),
      manifest: app.manifest,
      name: app.name,
    }).toMatchInlineSnapshot(`
      {
        "guide": "Worked on the web at https://x.com, where the user signs in in Instrument's browser, and searched with Instrument's own X tools on the user's Grok plan: \`instrument app tools x\` lists them, \`instrument app call x search '{"query": "..."}'\` runs one.
      ",
        "manifest": {
          "type": "web",
          "url": "https://x.com",
        },
        "name": "X",
      }
    `);
  });

  it("tells every app already on X's site that the plan is in, and sets up none", async () => {
    actionLog().clear();
    await seedApp("twitter", {
      name: "Twitter",
      setup: { type: "web", url: "https://twitter.com" },
    });

    const { answered, said } = await heard(grokPlanSignedInHere);

    expect(answered).toBeUndefined();
    expect(said).toEqual([
      "app.updated",
      {
        event: "connected",
        name: "Twitter",
        plan: "grok",
        slug: "twitter",
        web: "https://twitter.com",
      },
    ]);
    expect((await listApps()).apps.map((app) => app.slug)).toEqual(["twitter"]);
    // The person signed in to a plan, not to the app.
    expect(await actionLog().read({ since: 0 })).toEqual([]);
  });

  it("tells X apps the plan is in when an account is switched on, and sets up none", async () => {
    await seedApp("twitter", {
      name: "Twitter",
      setup: { type: "web", url: "https://twitter.com" },
    });

    expect((await heard(grokPlanSwitchedOnHere)).said).toEqual([
      "app.updated",
      expect.objectContaining({ event: "connected", plan: "grok" }),
    ]);
    await forgetApps();
    expect((await heard(grokPlanSwitchedOnHere)).said).toEqual([]);
    expect((await listApps()).apps).toEqual([]);
  });

  it("takes the next free id where another app is called x", async () => {
    await seedApp("x", {
      name: "Exa",
      setup: {
        auth: { kind: "none" },
        type: "mcp",
        url: "https://exa.example",
      },
    });

    expect(await grokPlanSignedInHere()).toBe("x-2");
    expect((await loadApp("x-2"))._unsafeUnwrap().manifest).toEqual({
      type: "web",
      url: "https://x.com",
    });
  });
});
