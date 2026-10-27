import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import { macAppNamed } from "../../lib/mac-apps/apps";
import { recordConnection } from "../../lib/apps/connection";
import { AppManifestSchema, AppSlugSchema } from "../../lib/apps/manifest";
import { guideSkeleton, loadApp, writeAppFolder } from "../../lib/apps/store";
import { type AbsolutePath } from "../../schemas/paths";
import { type WorkspaceConfig } from "../../types";

const require = createRequire(import.meta.url);

const STAND_IN = path.join(import.meta.dirname, "mac-apps-stand-in.ts");

const CallSchema = z.object({
  helper: z.array(z.string()).optional(),
  script: z.literal(true).optional(),
  server: z.string(),
  values: z.array(z.string()).optional(),
});

/**
 * The stand-in Mac apps' server (`mac-apps-stand-in.ts`) as a workspace's
 * `macAppsServer`, keeping its state in `dir`: what it is started with, the
 * calls it has had, which servers answer as macOS refusing them, and what
 * the calls added.
 */
export function macAppsStandIn(dir: string) {
  mkdirSync(dir, { recursive: true });
  const stateFile = path.join(dir, "state.json");
  const log = path.join(dir, "calls.jsonl");
  const store = path.join(dir, "store.json");
  writeFileSync(log, "");
  const refuse = (servers: string[]) => {
    writeFileSync(stateFile, JSON.stringify({ log, refuse: servers, store }));
  };
  refuse([]);
  return {
    calls: () =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => CallSchema.parse(JSON.parse(line))),
    launch: {
      args: [
        "--import",
        pathToFileURL(require.resolve("tsx/esm")).href,
        STAND_IN,
        stateFile,
      ],
      command: process.execPath,
    } satisfies NonNullable<WorkspaceConfig["macAppsServer"]>,
    refuse,
  };
}

/**
 * One of the Mac's own apps set up and connected in `appsDir`, as Connect
 * on its card leaves it: its folder under the Mac app's name, and the
 * go-ahead and the test on record for the manifest as written.
 */
export async function connectMacApp(appsDir: AbsolutePath, server: string) {
  const app = macAppNamed(server);
  if (app === undefined) {
    throw new Error(`no Mac app server is called ${server}`);
  }
  const slug = AppSlugSchema.parse(server);
  const manifest = AppManifestSchema.parse({
    auth: { kind: "none" },
    macApp: app.bundleId,
    package: server,
    runtime: "bundled",
    type: "mcp-local",
  });
  await writeAppFolder({
    appsDir,
    guide: guideSkeleton(manifest, undefined, slug),
    manifest,
    name: app.name,
    slug,
  });
  const { manifestHash } = (await loadApp(appsDir, slug))._unsafeUnwrap();
  await recordConnection(slug, {
    approvedManifestHash: manifestHash,
    manifestHash,
    status: "connected",
  });
  return slug;
}
