import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { publisher } from "../../rpc/publisher";
import { AbsolutePathSchema } from "../../schemas/paths";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { appChanged } from "./changed";

let appsDir: string;

beforeEach(async () => {
  appsDir = await fs.mkdtemp(path.join(os.tmpdir(), "app-changed-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    appsDir: AbsolutePathSchema.parse(appsDir),
  });
  await fs.mkdir(path.join(appsDir, "drafts"));
  await fs.writeFile(
    path.join(appsDir, "drafts", "app.json"),
    JSON.stringify({
      auth: { kind: "none" },
      name: "Drafts",
      package: "@agiletortoise/drafts-mcp-server",
      runtime: "node",
      type: "mcp-local",
    }),
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

  it("names an app whose folder is gone by its slug", async () => {
    expect(await heard(() => appChanged("gone", { event: "removed" }))).toEqual(
      ["app.updated", { event: "removed", name: "gone", slug: "gone" }],
    );
  });
});
