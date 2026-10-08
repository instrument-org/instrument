import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import { ensureOutputFolderIcon } from "@/electron-main/lib/output-folder-icon";
import {
  homeRelativePath,
  makeOutputFolder,
  outputFolderForPick,
} from "@/electron-main/lib/setup-folder";
import { base } from "@/electron-main/rpc/base";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import {
  defaultOutputFolderPath,
  outputFolderPath,
} from "@instrument-org/workspace/electron";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const AbsolutePathSchema = z
  .string()
  .refine((value) => path.isAbsolute(value), "Path must be absolute");

const LocationSchema = z.object({
  /** The folder's path as a person reads it, `~/Documents/Instrument`. */
  displayPath: z.string(),
  folderPath: z.string(),
  /** The name of the folder it sits in, `Documents`. */
  parentName: z.string(),
  /** Where the folder picker opens to choose another place. */
  parentPath: z.string(),
});

function describeLocation(folderPath: string): z.output<typeof LocationSchema> {
  const parentPath = path.dirname(folderPath);
  return {
    displayPath: homeRelativePath(folderPath, os.homedir()),
    folderPath,
    parentName: path.basename(parentPath),
    parentPath,
  };
}

/**
 * Where setup proposes the Instrument folder goes: the place already chosen,
 * or Documents. With `picked`, the place a pick in the folder picker stands
 * for. Reads nothing on disk, so the page can show it without making macOS
 * ask for Documents access before the person presses Continue.
 */
const location = base
  .input(z.object({ picked: AbsolutePathSchema.optional() }))
  .output(LocationSchema)
  .handler(({ input }) =>
    describeLocation(
      input.picked ? outputFolderForPick(input.picked) : outputFolderPath(),
    ),
  );

/**
 * Makes the Instrument folder where setup chose, or keeps the one already
 * there once the person has heard about it, then remembers the place and
 * gives the folder its icon. `denied` carries the folder the picker should
 * open at, since picking there is how the person grants access.
 */
const create = base
  .input(
    z.object({ folderPath: AbsolutePathSchema, keepExisting: z.boolean() }),
  )
  .output(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("made") }),
      z.object({ items: z.number(), kind: z.literal("exists") }),
      z.object({ kind: z.literal("denied"), pickAt: z.string() }),
    ]),
  )
  .handler(async ({ input }) => {
    const outcome = await makeOutputFolder(input);
    if (outcome.kind === "denied") {
      return { kind: "denied", pickAt: path.dirname(input.folderPath) };
    }
    if (outcome.kind === "exists") {
      return outcome;
    }
    const preferences = getMachinePreferences();
    if (input.folderPath === defaultOutputFolderPath()) {
      preferences.delete("outputFolder");
    } else {
      preferences.set("outputFolder", input.folderPath);
    }
    // The icon is decoration: a folder without it is still the folder.
    await ensureOutputFolderIcon(input.folderPath, input.folderPath).catch(
      (error: unknown) => {
        captureServerException(
          new Error("Setup could not give the output folder its icon", {
            cause: error,
          }),
          { scopes: ["studio"] },
        );
      },
    );
    return outcome;
  });

export const setupFolder = { create, location };
