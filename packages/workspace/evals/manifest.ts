import fs from "node:fs/promises";
import path from "node:path";

/**
 * Which eval case (and model) produced each task in an eval workspace. Task ids
 * are slugged from the prompt, so nothing in the workspace itself records the
 * case name that the report needs to pick assertions. `report <dir>` reads this
 * back, so a run and a later standalone report resolve cases identically.
 */
export type EvalManifest = Record<
  string,
  undefined | { modelURI: string; name: string }
>;

const MANIFEST_FILENAME = "eval-manifest.json";

export async function readEvalManifest(
  workspaceRootDir: string,
): Promise<EvalManifest> {
  try {
    const raw = await fs.readFile(
      path.join(workspaceRootDir, MANIFEST_FILENAME),
      "utf8",
    );
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as EvalManifest)
      : {};
  } catch {
    return {};
  }
}

export async function writeEvalManifest(
  workspaceRootDir: string,
  manifest: EvalManifest,
) {
  await fs.mkdir(workspaceRootDir, { recursive: true });
  await fs.writeFile(
    path.join(workspaceRootDir, MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}
