/**
 * Connects a local MCP app end to end, outside the app: writes the folder,
 * records the approval the user gives on the card, installs the package, runs
 * the server, and lists what it can do. Useful for checking that a server
 * runs here at all before asking anyone to allow it.
 *
 * Usage:
 *   pnpm script:try-local-app <slug> <package> [--runtime node|python] [--call <tool> '<json>']
 */

import "./lib/dev-node-env";

import "dotenv/config";

import "./lib/define-globals-apply";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { recordConnection } from "../src/lib/apps/connection";
import {
  AppManifestSchema,
  AppSlugSchema,
  isMcpManifest,
} from "../src/lib/apps/manifest";
import { callMcpTool, listMcpTools } from "../src/lib/apps/mcp/client";
import { withAppMcpClient } from "../src/lib/apps/mcp/run";
import { loadApp, writeAppFolder } from "../src/lib/apps/store";
import { formatAppTestReport, runAppTest } from "../src/lib/apps/test-app";
import { setWorkspaceConfig } from "../src/lib/workspace-config";
import { AbsolutePathSchema } from "../src/schemas/paths";
import { createStubWorkspaceConfig } from "./lib/stub-workspace-config";

const argv = process.argv.slice(2);

process.exitCode = await main();

async function findPnpmScript(): Promise<string> {
  const repoRoot = path.resolve(import.meta.dirname, "../../..");
  for await (const match of fs.glob(
    "node_modules/.pnpm/pnpm@*/node_modules/pnpm/bin/pnpm.cjs",
    { cwd: repoRoot },
  )) {
    return path.join(repoRoot, match);
  }
  throw new Error("No pnpm script found to install with.");
}

function flag(name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

async function main(): Promise<number> {
  const [rawSlug, packageSpec] = argv;
  if (!rawSlug || !packageSpec) {
    console.error(
      "Usage: pnpm script:try-local-app <slug> <package> [--runtime node|python] [--call <tool> '<json>']",
    );
    return 1;
  }
  const slug = AppSlugSchema.parse(rawSlug);
  const runtime = flag("--runtime") ?? "node";
  const callIndex = argv.indexOf("--call");
  const callTool = callIndex === -1 ? undefined : argv[callIndex + 1];
  const callArgs = callIndex === -1 ? "{}" : (argv[callIndex + 2] ?? "{}");

  const rootDir = path.join(os.tmpdir(), "instrument-local-app");
  await fs.mkdir(path.join(rootDir, "tasks"), { recursive: true });

  const config = createStubWorkspaceConfig({
    overrides: {
      // The app hands the workspace pnpm's own script for node to run
      // (`pnpm.mjs`), never a shell shim, so this finds the same shape: the
      // extensionless `pnpm` on PATH is ESM and node refuses to load it.
      pnpmBinPath: AbsolutePathSchema.parse(await findPnpmScript()),
      // The uv the app ships, which is what a python server runs under.
      uvBinPath: AbsolutePathSchema.parse(
        path.resolve(
          import.meta.dirname,
          "../../../apps/studio/resources/uv/uv",
        ),
      ),
    },
    rootDir,
    tasksDir: path.join(rootDir, "tasks"),
  });
  setWorkspaceConfig(config);

  await writeAppFolder({
    appsDir: config.appsDir,
    guide: `# ${slug}\n\nA local MCP server, for checking that it runs.\n`,
    manifest: AppManifestSchema.parse({
      auth: { kind: "none" },
      name: slug,
      package: packageSpec,
      runtime,
      type: "mcp-local",
    }),
    slug,
  });

  const loaded = await loadApp(config.appsDir, slug);
  if (loaded.isErr()) {
    console.error(loaded.error.message);
    return 1;
  }
  const { manifest, manifestHash } = loaded.value;
  if (!isMcpManifest(manifest)) {
    console.error("Not an MCP app.");
    return 1;
  }

  // What the user's click on the card records.
  await recordConnection(slug, {
    approvedManifestHash: manifestHash,
    status: "needs-approval",
  });

  console.error(`Installing and starting ${packageSpec}…`);
  const report = await runAppTest({
    appsDir: config.appsDir,
    signal: AbortSignal.timeout(300_000),
    slug,
  });
  console.log(formatAppTestReport(report));
  if (!report.passed) {
    return 1;
  }

  const tools = await withAppMcpClient({
    credential: null,
    manifest,
    manifestHash,
    run: (client) => listMcpTools(client),
    slug,
  });
  if (tools.isOk()) {
    console.log(`\n${tools.value.length} tools:`);
    for (const tool of tools.value) {
      console.log(`- ${tool.name}: ${tool.description.split("\n")[0] ?? ""}`);
    }
  }

  if (callTool) {
    const result = await withAppMcpClient({
      credential: null,
      manifest,
      manifestHash,
      run: (client) =>
        callMcpTool(client, {
          args: JSON.parse(callArgs) as Record<string, unknown>,
          name: callTool,
        }),
      slug,
    });
    console.log(
      `\n${callTool} ->`,
      result.isOk() ? result.value.text.slice(0, 2000) : result.error.message,
    );
  }
  return 0;
}
