import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { buildConnectorsContextText } from "./context";
import { guardConnectorManifestOverwrite } from "./guard-write";
import { type ApiConnectorManifest } from "./manifest";

let tmpDir: string;
let connectorsDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "connector-guard-"));
  connectorsDir = path.join(tmpDir, "connectors");
  await fs.mkdir(connectorsDir, { recursive: true });
  // Initialize the workspace config singleton (task dir is irrelevant here).
  createMockTaskConfigForDir(path.join(tmpDir, "app"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    connectors: { getCredential: () => Promise.resolve(null) },
    connectorsDir: AbsolutePathSchema.parse(connectorsDir),
  });
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

async function writeConnector(slug: string, enabled: boolean) {
  const dir = path.join(connectorsDir, slug);
  await fs.mkdir(dir, { recursive: true });
  const manifest: ApiConnectorManifest = {
    auth: { kind: "bearer" },
    baseUrl: "https://api.example.com",
    displayName: slug,
    enabled,
    test: { path: "/me" },
    type: "api",
  };
  await fs.writeFile(
    path.join(dir, "connector.json"),
    JSON.stringify(manifest, null, 2),
  );
  return path.join(dir, "connector.json");
}

describe("guardConnectorManifestOverwrite", () => {
  it("refuses to overwrite an enabled connector's manifest", async () => {
    const manifestPath = await writeConnector("linear", true);
    const result = await guardConnectorManifestOverwrite(
      AbsolutePathSchema.parse(manifestPath),
    );
    expect(result).toContain("already exists and is enabled");
  });

  it("allows overwriting a disabled connector", async () => {
    const manifestPath = await writeConnector("linear", false);
    const result = await guardConnectorManifestOverwrite(
      AbsolutePathSchema.parse(manifestPath),
    );
    expect(result).toBeNull();
  });

  it("allows creating a brand-new connector", async () => {
    const result = await guardConnectorManifestOverwrite(
      AbsolutePathSchema.parse(
        path.join(connectorsDir, "brand-new", "connector.json"),
      ),
    );
    expect(result).toBeNull();
  });

  it("ignores non-manifest files and files outside connectors/", async () => {
    await writeConnector("linear", true);
    expect(
      await guardConnectorManifestOverwrite(
        AbsolutePathSchema.parse(
          path.join(connectorsDir, "linear", "guide.md"),
        ),
      ),
    ).toBeNull();
    expect(
      await guardConnectorManifestOverwrite(
        AbsolutePathSchema.parse(path.join(tmpDir, "app", "connector.json")),
      ),
    ).toBeNull();
  });
});

describe("buildConnectorsContextText", () => {
  it("returns null when there are no connectors", async () => {
    expect(
      await buildConnectorsContextText({
        connectorsDir: AbsolutePathSchema.parse(connectorsDir),
        getCredential: () => Promise.resolve(null),
      }),
    ).toBeNull();
  });

  it("lists connectors with status and warns against recreating them", async () => {
    await writeConnector("linear", true);
    await writeConnector("notion", false);
    const text = await buildConnectorsContextText({
      connectorsDir: AbsolutePathSchema.parse(connectorsDir),
      getCredential: () => Promise.resolve(null),
    });
    expect(text).toContain("Do NOT recreate");
    expect(text).toContain("linear (linear) -- enabled");
    expect(text).toContain("notion (notion) -- disabled, needs credential");
  });
});
