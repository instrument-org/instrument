import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import { execa } from "execa";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema } from "../../../schemas/paths";
import { createMockChatConfig } from "../../../test/helpers/mock-chat-config";
import { ChatIdSchema } from "../../../schemas/chat-id";
import { getWorkspaceConfig, setWorkspaceConfig } from "../../workspace-config";
import { runtimeLayout } from "../../runtime-dir";
import { AppManifestSchema } from "../manifest";
import { prepareLocalServer } from "./local-server";

vi.mock("execa");

const manifest = AppManifestSchema.parse({
  auth: { kind: "none" },
  package: "@agiletortoise/drafts-mcp-server",
  runtime: "node",
  type: "mcp-local",
});

describe("prepareLocalServer", () => {
  let root = "";

  beforeEach(() => {
    createMockChatConfig(ChatIdSchema.parse("local-server"));
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "local-server-")),
    );
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      runtimeDir: AbsolutePathSchema.parse(path.join(root, "runtime")),
      workspaceMachineDir: AbsolutePathSchema.parse(path.join(root, "machine")),
    });
    // What the install leaves, for the entry check after it.
    const pkg = path.join(
      getWorkspaceConfig().workspaceMachineDir,
      WORKSPACE_MACHINE_ENTRIES.appServers,
      "drafts",
      "node_modules",
      "@agiletortoise",
      "drafts-mcp-server",
    );
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({ bin: "server.js" }),
    );
    fs.writeFileSync(path.join(pkg, "server.js"), "");
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stderr: "",
      stdout: "",
    } as never);
  });

  afterEach(() => {
    vi.mocked(execa).mockReset();
    fs.rmSync(root, { force: true, recursive: true });
  });

  // The server it installs runs outside every sandbox, so the registry it
  // comes from is the app's to say: a `registry=` planted in the person's
  // `~/.npmrc` or in a chat's npm config would choose its code.
  it("installs a node server with the app's own npm config in the build folders", async () => {
    if (manifest.type !== "mcp-local") {
      throw new Error("Expected a local app's manifest");
    }

    const prepared = await prepareLocalServer({ manifest, slug: "drafts" });

    expect(prepared.isOk()).toBe(true);
    const { buildCaches, buildConfig } = runtimeLayout(
      getWorkspaceConfig().runtimeDir,
    );
    expect(execa).toHaveBeenCalledWith(
      getWorkspaceConfig().pnpmBinPath,
      ["add", "@agiletortoise/drafts-mcp-server", "--ignore-workspace"],
      expect.objectContaining({
        env: expect.objectContaining({
          npm_config_globalconfig: path.join(buildConfig, "npmrc-global"),
          npm_config_userconfig: path.join(buildConfig, "npmrc"),
          pnpm_config_store_dir: path.join(buildCaches, "pnpm-store"),
          pnpm_config_userconfig: path.join(buildConfig, "npmrc"),
        }),
      }),
    );
    expect(fs.readFileSync(path.join(buildConfig, "npmrc"), "utf8")).toBe("");
  });
});
