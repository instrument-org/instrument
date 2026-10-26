import { revokeSession } from "@/electron-main/auth/client";
import { logger } from "@/electron-main/lib/electron-logger";
import {
  getUserDataDir,
  workspaceInAppData,
  workspaceKeysDir,
} from "@/electron-main/lib/get-workspace-folder";
import {
  choosePlacement,
  placeWorkspace,
} from "@/electron-main/lib/place-workspace";
import {
  canRelaunch,
  relaunchApp,
  restartNow,
} from "@/electron-main/lib/relaunch";
import { refreshSetupFacts } from "@/electron-main/lib/setup-facts";
import {
  answerSetupByPlacing,
  answerSetupIn,
  isSetupUp,
  rereadSetupRecord,
} from "@/electron-main/lib/setup-state";
import { startWorkspace } from "@/electron-main/lib/start-workspace";
import {
  getResolvedWorkspace,
  getWorkspaceRun,
  placeRun,
} from "@/electron-main/lib/workspace-run";
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
  checkFolderPick,
  checkMoveTarget,
  FolderPickSchema,
  MoveVerdictSchema,
  NotMovableSchema,
  requestWorkspaceMove,
} from "@/electron-main/lib/workspace-move";
import {
  DEFAULT_WORKSPACE_ID,
  machineDirOwnedBy,
  readRegistry,
  readWorkspaceIdentity,
  registerWorkspaceFolder,
  updateRegistry,
  WorkspaceColorSchema,
  WorkspaceIdentitySchema,
  workspaceMachineDirOf,
  workspacePlaceConcern,
} from "@/electron-main/lib/workspaces";
import { FolderRefusalSchema } from "@/shared/workspace-folder-refusal";
import { samePath } from "@/electron-main/lib/path-identity";
import { base, devOnly } from "@/electron-main/rpc/base";
import { isDeveloperMode } from "@/electron-main/stores/workspace/preferences";
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

/**
 * Which workspace this window shows, for the window bar's name and stripe.
 * Before setup places it, the one it will be, with no folder to name it.
 */
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
    const run = getWorkspaceRun();
    const workspace =
      run.kind === "unplaced"
        ? {
            id: run.id,
            isDefault: run.id === DEFAULT_WORKSPACE_ID,
            path: undefined,
            pinned: false,
          }
        : run.workspace;
    const identity =
      workspace.path === undefined
        ? WorkspaceIdentitySchema.parse({})
        : readWorkspaceIdentity(workspace.path);
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
      home === undefined
        ? app.getPath("documents")
        : path.join(home, "Documents"),
      HOME_FOLDERS.instrument,
    ),
    inHome: path.join(home ?? app.getPath("home"), HOME_FOLDERS.instrument),
  };
}

/**
 * The folders setup's folder step offers: one named for the build in
 * Documents first, and one in the home folder when Documents is refused.
 */
const offered = base
  .output(z.object({ inDocuments: z.string(), inHome: z.string() }))
  .handler(() => setupFolders());

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

/**
 * The workspace a picked folder is checked against: the one this process
 * runs, or one with no folder yet.
 */
function workspaceToPlace() {
  const run = getWorkspaceRun();
  return run.kind === "unplaced"
    ? { id: run.id, path: undefined, pinned: false }
    : run.workspace;
}

/**
 * Checks a folder the person picked as a place for the workspace, made first
 * with `create` (where macOS asks about Documents). `unmake` takes a folder
 * this made away again, still empty, for a caller that ends up not using it.
 */
function checkPicked({
  makeFirst,
  target,
}: {
  makeFirst: boolean | undefined;
  target: string;
}) {
  let made = false;
  if (makeFirst === true && path.isAbsolute(target)) {
    try {
      fs.mkdirSync(target);
      made = true;
    } catch {
      // Already there, or not makeable: the check says which.
    }
  }
  return {
    unmake: () => {
      if (made) {
        removeIfEmptySync(target);
      }
    },
    verdict: checkMoveTarget({
      target,
      userDataDir: getUserDataDir(),
      workspace: workspaceToPlace(),
    }),
  };
}

/** What a folder the person picked would be to their Instrument folder (`checkMoveTarget`). */
const checkFolder = base
  .input(z.object({ path: z.string() }))
  .output(MoveVerdictSchema)
  .handler(({ input }) =>
    checkMoveTarget({
      target: input.path,
      userDataDir: getUserDataDir(),
      workspace: workspaceToPlace(),
    }),
  );

/**
 * Where a folder the person picked puts their Instrument folder
 * (`checkFolderPick`): in a folder named for the build inside it, unless it
 * already has that name or already is an Instrument folder.
 */
const checkPick = base
  .input(z.object({ path: z.string() }))
  .output(FolderPickSchema)
  .handler(({ input }) =>
    checkFolderPick({
      name: HOME_FOLDERS.instrument,
      picked: input.path,
      userDataDir: getUserDataDir(),
      workspace: workspaceToPlace(),
    }),
  );

/**
 * Give an unplaced workspace its folder, from setup's folder step: the
 * folder the person picked or found, checked as a move to it would be, then
 * a new workspace made there or the one already there opened. One this
 * launch's local id can take as it is starts in this process, with no
 * restart, and the window loads again to show it; any other is registered
 * (re-pointing the entry of the same workspace on this computer, so its
 * sign-ins carry on) and opened by a restart (`choosePlacement`), with setup
 * answered there. A placed workspace whose start failed is started again.
 * A folder it can't take answers as `checkFolder` would.
 */
const place = base
  .input(z.object({ create: z.boolean().optional(), path: z.string() }))
  .output(
    z.union([
      NotMovableSchema,
      z.object({ kind: z.enum(["on-next-launch", "placed", "relaunching"]) }),
    ]),
  )
  .handler(async ({ errors, input }) => {
    const run = getWorkspaceRun();
    if (run.kind === "started") {
      throw errors.UNAUTHORIZED({ message: "The workspace has a folder" });
    }
    if (run.kind === "unplaced") {
      const picked = checkPicked({
        makeFirst: input.create,
        target: input.path,
      });
      if (picked.verdict.kind === "refused") {
        picked.unmake();
        return picked.verdict;
      }
      const how = choosePlacement({
        dir: input.path,
        unplaced: run,
        userDataDir: getUserDataDir(),
      });
      if (how.kind === "restart") {
        answerSetupIn(workspaceMachineDirOf(getUserDataDir(), how.id));
        // Nothing runs yet, so there is nothing to ask about or stop.
        return { kind: restartNow() ? "relaunching" : "on-next-launch" };
      }
      placeRun(
        placeWorkspace({
          dir: input.path,
          log: logger,
          packaged: app.isPackaged,
          unplaced: run,
          userDataDir: getUserDataDir(),
        }),
      );
      // The record a launch with a folder reads, the machine-wide one taken in.
      rereadSetupRecord();
    }
    await startWorkspace();
    answerSetupByPlacing();
    refreshSetupFacts();
    return { kind: "placed" as const };
  });

/**
 * Move the Instrument folder to a folder the person picked: checked again,
 * recorded for the next launch, and the app restarted to make it with
 * nothing open (`workspace-move.ts`). A folder it cannot move to answers
 * as `checkFolder` would; a restart the person declines over running
 * agents records nothing. With `create`, a folder not there yet is made
 * first (the folder `checkPick` names inside a pick), and taken away again,
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
    const { unmake, verdict } = checkPicked({
      makeFirst: input.create,
      target: input.path,
    });
    if (verdict.kind !== "movable") {
      unmake();
      return verdict;
    }
    const request = () => {
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
 * app restarted. The same workspace as an entry on this computer whose own
 * folder no longer holds it re-points that entry, so its sign-ins carry on;
 * any other gets a local id of its own. A place the person is only warned
 * of was shown to them when they picked it (`checkFolder`), so it opens.
 * Opened from setup's folder step, the restart picks up after the folder.
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
    const fromSetup = isSetupUp();
    const choose = () => {
      if (fromSetup) {
        answerSetupIn(workspaceMachineDirOf(getUserDataDir(), registered.id));
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

export const workspaces = {
  checkFolder,
  checkPick,
  create,
  current,
  folder,
  list,
  move,
  offered,
  open,
  place,
  register,
  remove,
  sizes,
  summary,
  switch: switchTo,
};
