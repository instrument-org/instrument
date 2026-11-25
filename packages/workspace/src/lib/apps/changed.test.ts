import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { publisher } from "../../rpc/publisher";
import { forgetApps, seedApp } from "../../test/helpers/seed-app";
import { actionLog } from "../actions/log";
import { getWorkspaceConfig } from "../workspace-config";
import { appChanged, appEventOf } from "./changed";

beforeEach(async () => {
  await seedApp("drafts", {
    name: "Drafts",
    setup: {
      auth: { kind: "none" },
      package: "@agiletortoise/drafts-mcp-server",
      runtime: "node",
      type: "mcp-local",
    },
  });
});

afterEach(async () => {
  await forgetApps();
});

/** What `act` publishes about apps, in order. */
async function heard(act: () => Promise<void>) {
  const said: unknown[] = [];
  const stops = [
    publisher.subscribe("app.updated", () => said.push("app.updated")),
    publisher.subscribe("app.event", (event) => said.push(event)),
  ];
  await act();
  for (const stop of stops) {
    stop();
  }
  return said;
}

describe("appChanged", () => {
  it("tells the lists, and the chat what the user did under the app's own name", async () => {
    expect(
      await heard(() =>
        appChanged("drafts", { detail: "12 tools", event: "connected" }),
      ),
    ).toEqual([
      "app.updated",
      {
        detail: "12 tools",
        event: "connected",
        name: "Drafts",
        slug: "drafts",
      },
    ]);
  });

  it.each([
    ["oauth", "external"],
    // A key the app uses has no sign-in, whatever its record kept of an earlier one.
    ["none", undefined],
  ] as const)(
    "tells where an app with %s sign-in signed in: %s",
    async (kind, from) => {
      await seedApp("tella", {
        name: "Tella",
        setup: {
          auth: { kind },
          type: "mcp",
          url: "https://api.tella.com/mcp",
        },
      });
      await getWorkspaceConfig().apps.connections.set("tella", {
        signedInFrom: "external",
        status: "connected",
        updatedAt: 0,
      });
      const event = await appEventOf("tella", { event: "connected" });
      expect(event.signedInFrom).toBe(from);
    },
  );

  it("keeps a sign-in going through or failing in the action log, by the app's name", async () => {
    actionLog().clear();
    await appChanged("drafts", { event: "connected" });
    await appChanged("drafts", { detail: "no key", event: "failed" });
    await appChanged("drafts", { event: "declined" });
    await appChanged("drafts", { event: "disconnected" });
    const logged = await actionLog().read({ since: 0 });
    actionLog().clear();
    expect(logged.map(({ at: _at, ...action }) => action)).toEqual([
      { did: "signed in", kind: "app", name: "Drafts" },
      { did: "sign-in failed", kind: "app", name: "Drafts" },
    ]);
  });

  it("tells only the lists when nobody did anything the chat should hear", async () => {
    expect(await heard(() => appChanged("drafts"))).toEqual(["app.updated"]);
  });

  it("tells the chat the site a web app is worked on", async () => {
    await seedApp("drive", {
      name: "Google Drive",
      setup: { type: "web", url: "https://drive.google.com" },
    });
    expect(
      await heard(() => appChanged("drive", { event: "connected" })),
    ).toEqual([
      "app.updated",
      {
        event: "connected",
        name: "Google Drive",
        slug: "drive",
        web: "https://drive.google.com",
      },
    ]);
  });

  it("names an app that is gone by its slug", async () => {
    expect(await heard(() => appChanged("gone", { event: "removed" }))).toEqual(
      ["app.updated", { event: "removed", name: "gone", slug: "gone" }],
    );
  });

  it("gives a sign-in of the app's own that failed the site to sign in on instead", async () => {
    await seedApp("linear", {
      name: "Linear",
      setup: {
        auth: { kind: "oauth" },
        type: "mcp",
        url: "https://mcp.linear.app/mcp",
      },
    });
    expect(
      await heard(async () => {
        await appChanged("linear", {
          detail: "access_denied: AADSTS65001",
          ended: "refused",
          event: "failed",
        });
        // A local server's failure has no site to go to.
        await appChanged("drafts", { detail: "exit 1", event: "failed" });
      }),
    ).toMatchInlineSnapshot(`
      [
        "app.updated",
        {
          "detail": "access_denied: AADSTS65001",
          "event": "failed",
          "name": "Linear",
          "signIn": {
            "ended": "refused",
            "web": "https://linear.app",
          },
          "slug": "linear",
        },
        "app.updated",
        {
          "detail": "exit 1",
          "event": "failed",
          "name": "Drafts",
          "slug": "drafts",
        },
      ]
    `);
  });
});
