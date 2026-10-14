import { revokeSession } from "@/electron-main/auth/client";
import { logger } from "@/electron-main/lib/electron-logger";
import {
  machineDir,
  workspaceKeysDir,
} from "@/electron-main/lib/get-workspace-folder";
import { canRelaunch, relaunchApp } from "@/electron-main/lib/relaunch";
import {
  createWorkspace,
  keysDirOf,
  listWorkspaces,
  registerStray,
  removeFolderIfEmpty,
  unregisterWorkspace,
  whyNotDeletable,
} from "@/electron-main/lib/workspace-management";
import {
  getResolvedWorkspace,
  machineDirOwnedBy,
  readRegistry,
  readWorkspaceIdentity,
  updateRegistry,
  WorkspaceColorSchema,
  WorkspaceIdentitySchema,
} from "@/electron-main/lib/workspaces";
import { samePath } from "@/electron-main/lib/path-identity";
import { base, devOnly } from "@/electron-main/rpc/base";
import { isDeveloperMode } from "@/electron-main/stores/workspace/preferences";
import { readBearerTokenIn } from "@/electron-main/stores/workspace/session";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import { shell } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

/**
 * How much a workspace takes on disk, from `du`, which walks a large default
 * workspace in well under a second where a stat per file in Node does not.
 * Null where there is no `du` (Windows) or it takes too long.
 */
async function sizeOnDisk(dir: string): Promise<null | number> {
  if (process.platform === "win32") {
    return null;
  }
  try {
    const { stdout } = await execFileAsync("du", ["-sk", dir], {
      timeout: 10_000,
    });
    const kilobytes = Number.parseInt(stdout, 10);
    return Number.isFinite(kilobytes) ? kilobytes * 1024 : null;
  } catch {
    return null;
  }
}

const userDataDir = machineDir;

const WorkspaceRowSchema = z.object({
  /** Why Delete is unavailable, or null when it is offered. */
  deleteBlockedBy: z.string().nullable(),
  id: z.string(),
  identity: WorkspaceIdentitySchema,
  isDefault: z.boolean(),
  /** Whether its folder is there to read; an unreachable one stays listed. */
  isReachable: z.boolean(),
  isRegistered: z.boolean(),
  isResolved: z.boolean(),
  lastOpenedAt: z.number().nullable(),
  path: z.string(),
});

/** Which workspace this window shows, for the window bar's name and stripe. */
const current = base
  .output(
    z.object({
      color: WorkspaceColorSchema,
      id: z.string(),
      isDefault: z.boolean(),
      name: z.string(),
      pinned: z.boolean(),
    }),
  )
  .handler(() => {
    const workspace = getResolvedWorkspace();
    const identity = readWorkspaceIdentity(workspace.path);
    return {
      color: identity.color,
      id: workspace.id,
      isDefault: workspace.isDefault,
      name: identity.name,
      pinned: workspace.pinned,
    };
  });

const list = devOnly
  .output(
    z.object({
      pinned: z.boolean(),
      workspaces: z.array(WorkspaceRowSchema),
    }),
  )
  .handler(() => {
    const resolved = getResolvedWorkspace();
    const listings = listWorkspaces({ resolved, userDataDir: userDataDir() });
    return {
      pinned: resolved.pinned,
      workspaces: listings.map((listing) => ({
        deleteBlockedBy: whyNotDeletable(listing, userDataDir()),
        id: listing.id,
        identity: listing.identity,
        isDefault: listing.isDefault,
        isReachable: listing.isReachable,
        isRegistered: listing.isRegistered,
        isResolved: listing.isResolved,
        lastOpenedAt: listing.lastOpenedAt,
        path: listing.path,
      })),
    };
  });

/**
 * How much each workspace takes on disk, by path. Its own call because a large
 * workspace takes `du` a while, and the menu that lists workspaces must not
 * wait on it.
 */
const sizes = devOnly
  .output(z.record(z.string(), z.number().nullable()))
  .handler(async () => {
    const listings = listWorkspaces({
      resolved: getResolvedWorkspace(),
      userDataDir: userDataDir(),
    });
    const measured = await Promise.all(
      listings.map(
        async (listing): Promise<[string, null | number]> => [
          listing.path,
          await sizeOnDisk(listing.path),
        ],
      ),
    );
    return Object.fromEntries(measured);
  });

const create = devOnly
  .input(
    z.object({
      color: WorkspaceColorSchema,
      copySignIns: z.boolean(),
      name: z.string().trim().min(1).max(60),
    }),
  )
  .output(z.object({ id: z.string() }))
  .handler(({ input }) => {
    const { id } = createWorkspace({
      color: input.color,
      copySignInsFrom: input.copySignIns ? workspaceKeysDir() : null,
      developerMode: isDeveloperMode(),
      name: input.name,
      userDataDir: userDataDir(),
    });
    return { id };
  });

const switchTo = devOnly
  .input(z.object({ id: z.string() }))
  .output(
    z.object({ outcome: z.enum(["canceled", "relaunching", "unsupported"]) }),
  )
  .handler(async ({ errors, input }) => {
    const resolved = getResolvedWorkspace();
    if (resolved.pinned) {
      throw errors.UNAUTHORIZED({
        message:
          "This instance is pinned to its workspace by INSTRUMENT_WORKSPACE",
      });
    }
    if (
      !readRegistry(userDataDir()).workspaces.some((w) => w.id === input.id)
    ) {
      throw errors.NOT_FOUND({ message: `No workspace "${input.id}"` });
    }
    const choose = () => {
      updateRegistry(userDataDir(), (registry) => ({
        ...registry,
        active: input.id,
      }));
    };
    // A build that cannot restart itself opens the chosen workspace the next
    // time it is started by hand.
    if (!canRelaunch()) {
      choose();
      return { outcome: "unsupported" as const };
    }
    return { outcome: await relaunchApp({ beforeRestart: choose }) };
  });

const remove = devOnly
  .input(z.object({ path: z.string() }))
  .handler(async ({ errors, input }) => {
    const listings = listWorkspaces({
      resolved: getResolvedWorkspace(),
      userDataDir: userDataDir(),
    });
    const listing = listings.find((candidate) =>
      samePath(candidate.path, input.path),
    );
    if (!listing) {
      throw errors.NOT_FOUND({ message: "No such workspace" });
    }
    const blocked = whyNotDeletable(listing, userDataDir());
    if (blocked) {
      throw errors.UNAUTHORIZED({ message: blocked });
    }
    // The sign-in goes with the workspace, so the platform session behind it
    // ends too, unless another workspace holds the same one (a workspace made
    // with the sign-in copied shares its session), which would be signed out
    // with it.
    const token = readBearerTokenIn(keysDirOf(userDataDir(), listing));
    const sharedWith = listings.some(
      (other) =>
        other !== listing &&
        readBearerTokenIn(keysDirOf(userDataDir(), other)) === token,
    );
    if (token !== null && !sharedWith) {
      await revokeSession(token).catch((error: unknown) => {
        logger.warn("Could not end the deleted workspace's session", error);
      });
    }
    // Read before its `.instrument/` goes, since the id that says the
    // machine folder is its own is in it. Its keys and browser profiles go
    // to the Trash too. Of the folder itself only the app's part goes: what
    // else is in it is the person's (finished work, downloads), and the
    // folder is removed only once that leaves it empty. A folder that cannot
    // be reached is only taken off the list: nothing of it can be read to
    // say what is its own.
    const ownMachineDir = machineDirOwnedBy(userDataDir(), listing);
    if (listing.isReachable) {
      await shell.trashItem(workspaceLayout(listing.path).dataDir);
      removeFolderIfEmpty(listing.path);
    }
    if (ownMachineDir !== undefined) {
      await shell.trashItem(ownMachineDir);
    }
    unregisterWorkspace({ dir: listing.path, userDataDir: userDataDir() });
  });

const register = devOnly
  .input(z.object({ path: z.string() }))
  .handler(({ errors, input }) => {
    const registered = registerStray({
      dir: input.path,
      resolved: getResolvedWorkspace(),
      userDataDir: userDataDir(),
    });
    if (!registered) {
      throw errors.NOT_FOUND({ message: "Not an unlisted workspace" });
    }
  });

export const workspaces = {
  create,
  current,
  list,
  register,
  remove,
  sizes,
  switch: switchTo,
};
