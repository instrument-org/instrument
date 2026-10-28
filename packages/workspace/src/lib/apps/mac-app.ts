import { type Asker } from "../chat/asks";
import { MAC_APPS, macAppNamed } from "../mac-apps/apps";
import { macosRefusalIn } from "../mac-apps/refusal";
import { type MacAppDefinition } from "../mac-apps/tool";
import { macosAppCard, noteMacAppAnswer } from "../permissions/macos";
import { getWorkspaceConfig } from "../workspace-config";
import { type AppManifest } from "./manifest";

/**
 * The Mac app an app's manifest runs the bundled server of, whatever the
 * app's own slug: what decides the gate below, so an app folder of any name
 * pointed at Mail is held to Mail's.
 */
export function bundledMacApp(
  manifest: AppManifest,
): MacAppDefinition | undefined {
  return manifest.type === "mcp-local" && manifest.runtime === "bundled"
    ? macAppNamed(manifest.package)
    : undefined;
}

/**
 * The bundled Mac app for the Mac app `bundleId` names, where this computer
 * and build can run it: macOS, the server shipped, and the helper too for
 * the apps it answers.
 */
export function bundledMacAppHere(
  bundleId: string,
): MacAppDefinition | undefined {
  const { macAppsServer, macHelperBinPath } = getWorkspaceConfig();
  if (process.platform !== "darwin" || macAppsServer === undefined) {
    return undefined;
  }
  const app = MAC_APPS.find((each) => each.bundleId === bundleId);
  return app?.through === "helper" && macHelperBinPath === undefined
    ? undefined
    : app;
}

/**
 * The arguments with each file argument of the tool (Mail's attachments)
 * resolved by `readableFile`, which holds it to the chat's folder rules and
 * throws what it refuses: the app reads it outside every sandbox.
 */
export async function withReadableFiles(
  app: MacAppDefinition,
  tool: string,
  args: Record<string, unknown>,
  readableFile: (named: string) => Promise<string>,
): Promise<Record<string, unknown>> {
  const files = app.tools.find((each) => each.name === tool)?.files ?? [];
  const resolved = { ...args };
  for (const name of files) {
    const given: unknown = resolved[name];
    if (Array.isArray(given)) {
      const each: unknown[] = given;
      resolved[name] = await Promise.all(
        each.map((named) =>
          typeof named === "string" ? readableFile(named) : named,
        ),
      );
    } else if (typeof given === "string") {
      resolved[name] = await readableFile(given);
    }
  }
  return resolved;
}

/**
 * The card for what a Mac app's tool result says of macOS, raised once the
 * server named its refusal: refused outright, or an Apple Event that timed
 * out while macOS's prompt was up, which macOS is asked about now. Undefined
 * when the result names none, or the timeout was the app being slow.
 */
export async function macosRefusalCard({
  app,
  asker,
  isError,
  meta,
}: {
  app: MacAppDefinition;
  asker: Asker;
  isError: boolean;
  meta: unknown;
}): Promise<{ askId: string; message: string } | undefined> {
  const refusal = isError ? macosRefusalIn(meta) : undefined;
  if (refusal === undefined) {
    if (!isError) {
      noteMacAppAnswer(app, "allowed");
    }
    return undefined;
  }
  if (refusal.reason === "denied") {
    noteMacAppAnswer(app, "denied");
    return macosAppCard(asker, app, { known: "denied" });
  }
  return macosAppCard(asker, app);
}
