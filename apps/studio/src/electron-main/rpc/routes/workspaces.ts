import { revokeSession } from "@/electron-main/auth/client";
import { logger } from "@/electron-main/lib/electron-logger";
import {
  getUserDataDir,
  workspaceInAppData,
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
  checkMoveTarget,
  MoveVerdictSchema,
  NotMovableSchema,
  requestWorkspaceMove,
} from "@/electron-main/lib/workspace-move";
import {
  getResolvedWorkspace,
  machineDirOwnedBy,
  readRegistry,
  readWorkspaceIdentity,
  registerWorkspaceFolder,
  updateRegistry,
  WorkspaceColorSchema,
  WorkspaceIdentitySchema,
} from "@/electron-main/lib/workspaces";
import { samePath } from "@/electron-main/lib/path-identity";
import { base, devOnly } from "@/electron-main/rpc/base";
import { isDeveloperMode } from "@/electron-main/stores/workspace/preferences";
import { readBearerTokenIn } from "@/electron-main/stores/workspace/session";
import { instrumentFolderUnchosen } from "@instrument-org/workspace/electron";
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
    const listings = listWorkspaces({
      resolved,
      userDataDir: getUserDataDir(),
    });
    return {
      pinned: resolved.pinned,
      workspaces: listings.map((listing) => ({
        deleteBlockedBy: whyNotDeletable(listing, getUserDataDir()),
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
      userDataDir: getUserDataDir(),
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
      userDataDir: getUserDataDir(),
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
      !readRegistry(getUserDataDir()).workspaces.some((w) => w.id === input.id)
    ) {
      throw errors.NOT_FOUND({ message: `No workspace "${input.id}"` });
    }
    const choose = () => {
      updateRegistry(getUserDataDir(), (registry) => ({
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
      userDataDir: getUserDataDir(),
    });
    const listing = listings.find((candidate) =>
      samePath(candidate.path, input.path),
    );
    if (!listing) {
      throw errors.NOT_FOUND({ message: "No such workspace" });
    }
    const blocked = whyNotDeletable(listing, getUserDataDir());
    if (blocked) {
      throw errors.UNAUTHORIZED({ message: blocked });
    }
    // The sign-in goes with the workspace, so the platform session behind it
    // ends too, unless another workspace holds the same one (a workspace made
    // with the sign-in copied shares its session), which would be signed out
    // with it.
    const token = readBearerTokenIn(keysDirOf(getUserDataDir(), listing));
    const sharedWith = listings.some(
      (other) =>
        other !== listing &&
        readBearerTokenIn(keysDirOf(getUserDataDir(), other)) === token,
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
    const ownMachineDir = machineDirOwnedBy(getUserDataDir(), listing);
    if (listing.isReachable) {
      await shell.trashItem(workspaceLayout(listing.path).dataDir);
      removeFolderIfEmpty(listing.path);
    }
    if (ownMachineDir !== undefined) {
      await shell.trashItem(ownMachineDir);
    }
    unregisterWorkspace({ dir: listing.path, userDataDir: getUserDataDir() });
  });

const register = devOnly
  .input(z.object({ path: z.string() }))
  .handler(({ errors, input }) => {
    const registered = registerStray({
      dir: input.path,
      resolved: getResolvedWorkspace(),
      userDataDir: getUserDataDir(),
    });
    if (!registered) {
      throw errors.NOT_FOUND({ message: "Not an unlisted workspace" });
    }
  });

/**
 * Where the person's Instrument folder is: still in the app's own data, or a
 * folder they picked; and the folder the picker suggests for it.
 */
const folder = base
  .output(
    z.object({
      inAppData: z.boolean(),
      path: z.string(),
      /** Set by `INSTRUMENT_WORKSPACE`, which keeps it where it is. */
      pinned: z.boolean(),
      suggested: z.string(),
    }),
  )
  .handler(() => {
    const workspace = getResolvedWorkspace();
    return {
      inAppData: workspaceInAppData(),
      path: workspace.path,
      pinned: workspace.pinned,
      suggested: instrumentFolderUnchosen(),
    };
  });

/** What a folder the person picked would be to their Instrument folder (`checkMoveTarget`). */
const checkFolder = base
  .input(z.object({ path: z.string() }))
  .output(MoveVerdictSchema)
  .handler(({ input }) =>
    checkMoveTarget({
      target: input.path,
      userDataDir: getUserDataDir(),
      workspace: getResolvedWorkspace(),
    }),
  );

/**
 * Move the Instrument folder to a folder the person picked: checked again,
 * recorded for the next launch, and the app restarted to make it with
 * nothing open (`workspace-move.ts`). A folder it cannot move to answers
 * as `checkFolder` would; a restart the person declines over running
 * agents records nothing.
 */
const move = base
  .input(z.object({ path: z.string() }))
  .output(
    z.union([
      NotMovableSchema,
      z.object({
        kind: z.enum(["canceled", "on-next-launch", "relaunching"]),
      }),
    ]),
  )
  .handler(async ({ input }) => {
    const workspace = getResolvedWorkspace();
    const verdict = checkMoveTarget({
      target: input.path,
      userDataDir: getUserDataDir(),
      workspace,
    });
    if (verdict.kind !== "movable") {
      return verdict;
    }
    const request = () => {
      requestWorkspaceMove({
        target: input.path,
        userDataDir: getUserDataDir(),
        workspace,
      });
    };
    // A build that cannot restart itself makes the move the next time it is
    // started by hand.
    if (!canRelaunch()) {
      request();
      return { kind: "on-next-launch" as const };
    }
    return { kind: await relaunchApp({ beforeRestart: request }) };
  });

/**
 * Open the Instrument folder in a folder the person picked that already
 * holds one, in place of this one, which stays where it is: registered and
 * made the one to open, then the app restarted.
 */
const open = base
  .input(z.object({ path: z.string() }))
  .output(
    z.object({
      outcome: z.enum([
        "canceled",
        "not-a-workspace",
        "relaunching",
        "unsupported",
      ]),
    }),
  )
  .handler(async ({ errors, input }) => {
    if (getResolvedWorkspace().pinned) {
      throw errors.UNAUTHORIZED({
        message:
          "This instance is pinned to its workspace by INSTRUMENT_WORKSPACE",
      });
    }
    const registered = registerWorkspaceFolder({
      dir: input.path,
      userDataDir: getUserDataDir(),
    });
    if (registered === undefined) {
      return { outcome: "not-a-workspace" as const };
    }
    const choose = () => {
      updateRegistry(getUserDataDir(), (registry) => ({
        ...registry,
        active: registered.id,
      }));
    };
    if (!canRelaunch()) {
      choose();
      return { outcome: "unsupported" as const };
    }
    return { outcome: await relaunchApp({ beforeRestart: choose }) };
  });

export const workspaces = {
  checkFolder,
  create,
  current,
  folder,
  list,
  move,
  open,
  register,
  remove,
  sizes,
  switch: switchTo,
};
