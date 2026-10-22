import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { publisher } from "../../rpc/publisher";
import { AbsolutePathSchema } from "../../schemas/paths";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { APP_FILE_NAME } from "./app-file";
import { appChanged } from "./changed";

let appsDir: string;

beforeEach(async () => {
  appsDir = await fs.mkdtemp(path.join(os.tmpdir(), "app-changed-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    appsDir: AbsolutePathSchema.parse(appsDir),
  });
  await fs.mkdir(path.join(appsDir, "Drafts"));
  await fs.writeFile(
    path.join(appsDir, "Drafts", APP_FILE_NAME),
    [
      "---",
      "id: drafts",
      "type: mcp-local",
      "package: '@agiletortoise/drafts-mcp-server'",
      "runtime: node",
      "auth:",
      "  kind: none",
      "---",
      "",
    ].join("\n"),
  );
});

afterEach(async () => {
  await fs.rm(appsDir, { force: true, recursive: true });
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

  it("tells only the lists when nobody did anything the chat should hear", async () => {
    expect(await heard(() => appChanged("drafts"))).toEqual(["app.updated"]);
  });

  it("tells the chat the site a web app is worked on", async () => {
    await fs.mkdir(path.join(appsDir, "Google Drive"));
    await fs.writeFile(
      path.join(appsDir, "Google Drive", APP_FILE_NAME),
      [
        "---",
        "id: drive",
        "type: web",
        "url: https://drive.google.com",
        "---",
        "",
      ].join("\n"),
    );
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

  it("names an app whose folder is gone by its slug", async () => {
    expect(await heard(() => appChanged("gone", { event: "removed" }))).toEqual(
      ["app.updated", { event: "removed", name: "gone", slug: "gone" }],
    );
  });

  it("gives a sign-in of the app's own that failed the site to sign in on instead", async () => {
    await fs.mkdir(path.join(appsDir, "Linear"));
    await fs.writeFile(
      path.join(appsDir, "Linear", APP_FILE_NAME),
      [
        "---",
        "id: linear",
        "type: mcp",
        "url: https://mcp.linear.app/mcp",
        "auth:",
        "  kind: oauth",
        "---",
        "",
      ].join("\n"),
    );
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
