import { relaunchApp } from "@/electron-main/lib/relaunch";
import {
  createWorkspace,
  listWorkspaces,
  registerStray,
  unregisterWorkspace,
  whyNotDeletable,
} from "@/electron-main/lib/workspace-management";
import {
  getResolvedWorkspace,
  readRegistry,
  readWorkspaceIdentity,
  updateRegistry,
  WorkspaceColorSchema,
  WorkspaceIdentitySchema,
} from "@/electron-main/lib/workspaces";
import { base, devOnly } from "@/electron-main/rpc/base";
import { isDeveloperMode } from "@/electron-main/stores/workspace/preferences";
import { app, shell } from "electron";
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

const userDataDir = () => app.getPath("userData");

const WorkspaceRowSchema = z.object({
  /** Why Delete is unavailable, or null when it is offered. */
  deleteBlockedBy: z.string().nullable(),
  id: z.string(),
  identity: WorkspaceIdentitySchema,
  isDefault: z.boolean(),
  isRegistered: z.boolean(),
  isResolved: z.boolean(),
  lastOpenedAt: z.number().nullable(),
  path: z.string(),
  sizeBytes: z.number().nullable(),
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
  .handler(async () => {
    const resolved = getResolvedWorkspace();
    const listings = listWorkspaces({ resolved, userDataDir: userDataDir() });
    const sizes = await Promise.all(
      listings.map((listing) => sizeOnDisk(listing.path)),
    );
    return {
      pinned: resolved.pinned,
      workspaces: listings.map((listing, index) => ({
        deleteBlockedBy: whyNotDeletable(listing),
        id: listing.id,
        identity: listing.identity,
        isDefault: listing.isDefault,
        isRegistered: listing.isRegistered,
        isResolved: listing.isResolved,
        lastOpenedAt: listing.lastOpenedAt,
        path: listing.path,
        sizeBytes: sizes[index] ?? null,
      })),
    };
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
      copySignInsFrom: input.copySignIns ? getResolvedWorkspace().path : null,
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
    if (!readRegistry(userDataDir()).workspaces.some((w) => w.id === input.id)) {
      throw errors.NOT_FOUND({ message: `No workspace "${input.id}"` });
    }
    updateRegistry(userDataDir(), (registry) => ({
      ...registry,
      active: input.id,
    }));
    // Written first either way: a build that cannot restart itself opens the
    // chosen workspace the next time it is started by hand.
    return { outcome: await relaunchApp() };
  });

const remove = devOnly
  .input(z.object({ path: z.string() }))
  .handler(async ({ errors, input }) => {
    const listing = listWorkspaces({
      resolved: getResolvedWorkspace(),
      userDataDir: userDataDir(),
    }).find((candidate) => candidate.path === input.path);
    if (!listing) {
      throw errors.NOT_FOUND({ message: "No such workspace" });
    }
    const blocked = whyNotDeletable(listing);
    if (blocked) {
      throw errors.UNAUTHORIZED({ message: blocked });
    }
    await shell.trashItem(listing.path);
    unregisterWorkspace({ dir: listing.path, userDataDir: userDataDir() });
  });

const register = devOnly
  .input(z.object({ path: z.string() }))
  .handler(({ input }) => {
    registerStray({ dir: input.path, userDataDir: userDataDir() });
  });

export const workspaces = {
  create,
  current,
  list,
  register,
  remove,
  switch: switchTo,
};
