import { revokeSession } from "@/electron-main/auth/client";
import { logger } from "@/electron-main/lib/electron-logger";
import {
  getUserDataDir,
  workspaceInAppData,
  workspaceKeysDir,
  workspaceMachineDir,
} from "@/electron-main/lib/get-workspace-folder";
import { canRelaunch, relaunchApp } from "@/electron-main/lib/relaunch";
import { refreshSetupFacts } from "@/electron-main/lib/setup-facts";
import {
  answerSetupFolderChange,
  isSetupOnFolderStep,
} from "@/electron-main/lib/setup-state";
import {
  carrySignIns,
  macClaudeKeychain,
} from "@/electron-main/lib/sign-in-carry";
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
  workspacePlaceConcern,
} from "@/electron-main/lib/workspaces";
import { FolderRefusalSchema } from "@/shared/workspace-folder-refusal";
import { samePath } from "@/electron-main/lib/path-identity";
import { base, devOnly } from "@/electron-main/rpc/base";
import {
  getDefaultModelURI,
  isDeveloperMode,
} from "@/electron-main/stores/workspace/preferences";
import {
  platformApiBaseUrl,
  platformApiOrigin,
} from "@/electron-main/platform-api/base-url";
import { readBearerTokensIn } from "@/electron-main/stores/workspace/session";
import {
  instrumentFolderUnchosen,
  removeIfEmptySync,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import { HOME_FOLDERS } from "@instrument-org/shared";
import { app, shell } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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
    // The sign-ins go with the workspace, so the platform session behind
    // each ends too, on its own server, unless another workspace holds the
    // same one (a workspace made with the sign-in copied shares its
    // session), which would be signed out with it.
    const others = listings
      .filter((other) => other !== listing)
      .map((other) => readBearerTokensIn(keysDirOf(getUserDataDir(), other)));
    const tokens = readBearerTokensIn(keysDirOf(getUserDataDir(), listing));
    await Promise.all(
      Object.entries(tokens)
        .filter(([origin, token]) =>
          others.every((held) => held[origin] !== token),
        )
        .map(([origin, token]) =>
          revokeSession(
            token,
            origin === platformApiOrigin() ? platformApiBaseUrl() : origin,
          ).catch((error: unknown) => {
            logger.warn("Could not end the deleted workspace's session", error);
          }),
        ),
    );
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
 * The folders setup offers. A development build given
 * `INSTRUMENT_SETUP_HOME` (studio-drive's scenarios) offers them inside it,
 * so pressing Continue never makes a folder in the developer's own
 * Documents.
 */
function setupFolders() {
  const home = app.isPackaged ? undefined : process.env.INSTRUMENT_SETUP_HOME;
  return {
    inDocuments: path.join(
      home === undefined ? app.getPath("documents") : path.join(home, "Documents"),
      HOME_FOLDERS.instrument,
    ),
    inHome: path.join(home ?? app.getPath("home"), HOME_FOLDERS.instrument),
  };
}

/**
 * Where the person's Instrument folder is: still in the app's own data, or a
 * folder they picked; and the folder the picker suggests for it.
 */
const folder = base
  .output(
    z.object({
      inAppData: z.boolean(),
      path: z.string(),
      /** The folder setup suggests first: one named for the build in Documents. */
      inDocuments: z.string(),
      /** Where setup puts it when Documents is refused: one named for the build in the home folder. */
      inHome: z.string(),
      /** Set by `INSTRUMENT_WORKSPACE`, which keeps it where it is. */
      pinned: z.boolean(),
      suggested: z.string(),
    }),
  )
  .handler(() => {
    const workspace = getResolvedWorkspace();
    return {
      inAppData: workspaceInAppData(),
      ...setupFolders(),
      path: workspace.path,
      pinned: workspace.pinned,
      suggested: instrumentFolderUnchosen(),
    };
  });

/**
 * What a folder already has in it, for setup to say before it saves there:
 * its entries (file managers' own records aside), and the chats of the
 * Instrument folder it is, if it is one. Null where it isn't there or can't
 * be read.
 */
const summary = base
  .input(z.object({ path: z.string() }))
  .output(z.object({ chats: z.number(), items: z.number() }).nullable())
  .handler(({ input }) => {
    if (!path.isAbsolute(input.path)) {
      return null;
    }
    let names: string[];
    try {
      names = fs.readdirSync(input.path);
    } catch {
      return null;
    }
    let chats = 0;
    try {
      chats = fs.readdirSync(workspaceLayout(input.path).chatsDir).length;
    } catch {
      // Not an Instrument folder, or one with no chats yet.
    }
    return {
      chats,
      items: names.filter(
        (name) => ![".DS_Store", "desktop.ini", "Thumbs.db"].includes(name),
      ).length,
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
 * agents records nothing. With `create`, a folder not there yet is made
 * first (the better folder `checkFolder` offered), and taken away again,
 * still empty, when nothing is recorded to move into it.
 */
const move = base
  .input(z.object({ create: z.boolean().optional(), path: z.string() }))
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
    let made = false;
    if (input.create === true && path.isAbsolute(input.path)) {
      try {
        fs.mkdirSync(input.path);
        made = true;
      } catch {
        // Already there, or not makeable: the check says which.
      }
    }
    const unmake = () => {
      if (made) {
        removeIfEmptySync(input.path);
      }
    };
    const verdict = checkMoveTarget({
      target: input.path,
      userDataDir: getUserDataDir(),
      workspace,
    });
    if (verdict.kind !== "movable") {
      unmake();
      return verdict;
    }
    const fromSetup = isSetupOnFolderStep();
    const request = () => {
      if (fromSetup) {
        answerSetupFolderChange();
      }
      requestWorkspaceMove({
        target: input.path,
        userDataDir: getUserDataDir(),
        workspace,
      });
      // A recorded move settles setup's folder step.
      refreshSetupFacts();
    };
    // A build that cannot restart itself makes the move the next time it is
    // started by hand.
    if (!canRelaunch()) {
      request();
      return { kind: "on-next-launch" as const };
    }
    const outcome = await relaunchApp({ beforeRestart: request });
    if (outcome === "canceled") {
      unmake();
    }
    return { kind: outcome };
  });

/**
 * Open the Instrument folder in a folder the person picked that already
 * holds one, in place of this one, which stays where it is: checked for a
 * place no workspace can be, registered and made the one to open, then the
 * app restarted. A place the person is only warned of was shown to them
 * when they picked it (`checkFolder`), so it opens. Opened from setup's
 * folder step, it takes along the sign-ins and main model made in setup,
 * which are this workspace's, and setup picks up after the folder step.
 */
const open = base
  .input(z.object({ path: z.string() }))
  .output(
    z.union([
      z.object({
        outcome: z.enum([
          "canceled",
          "not-a-workspace",
          "relaunching",
          "unsupported",
        ]),
      }),
      z.object({ outcome: z.literal("refused"), reason: FolderRefusalSchema }),
    ]),
  )
  .handler(async ({ errors, input }) => {
    if (getResolvedWorkspace().pinned) {
      throw errors.UNAUTHORIZED({
        message:
          "This instance is pinned to its workspace by INSTRUMENT_WORKSPACE",
      });
    }
    const concern = workspacePlaceConcern({
      dir: input.path,
      userDataDir: getUserDataDir(),
    });
    if (concern?.kind === "refused") {
      return { outcome: "refused" as const, reason: concern.reason };
    }
    const registered = registerWorkspaceFolder({
      dir: input.path,
      userDataDir: getUserDataDir(),
    });
    if (registered === undefined) {
      return { outcome: "not-a-workspace" as const };
    }
    const fromSetup = isSetupOnFolderStep();
    const choose = () => {
      if (fromSetup) {
        carryIntoOpened({ id: registered.id, path: input.path });
        answerSetupFolderChange();
      }
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

/** The sign-ins and main model made in setup, into the workspace it opens. */
function carryIntoOpened(workspace: { id: string; path: string }) {
  try {
    const done = carrySignIns({
      fromMachineDir: workspaceMachineDir(),
      keychain: process.platform === "darwin" ? macClaudeKeychain : undefined,
      model: getDefaultModelURI(),
      userDataDir: getUserDataDir(),
      workspace,
    });
    logger.info("Carried setup's sign-ins into the opened workspace", {
      done,
    });
  } catch (error) {
    // The workspace still opens, signed out where nothing came along.
    logger.error("Couldn't carry setup's sign-ins", error);
  }
}

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
  summary,
  switch: switchTo,
};
