import {
  type IFileSystem,
  InMemoryFs,
  MountableFs,
  OverlayFs,
  ReadWriteFs,
} from "just-bash";
import { existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

import {
  CHAT_FOLDER_NAMES,
  DRAFTS_FOLDER_NAME,
  HANDOFF_NOTES_FILE_NAME,
} from "../constants";
import { type MountedFolder } from "../schemas/mounted-folder";
import { type Listings, ruleRefusal, rulesFs } from "./permissions/rules-fs";
import { shellPath } from "./shell-path";
import { appUpdateCaches, windowsProgramFolders } from "./permissions/places";
import { reachOf, type Rule, type Rules } from "./permissions/rules";
import {
  type AbsolutePath,
  AbsolutePathSchema,
  type ChatDir,
  type WorkDir,
} from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import {
  canonicalizeThroughMissing,
  hostPathWithin,
  realHostPath,
  realRoot,
} from "./host-path";
import { normalizePath } from "./normalize-path";
import { chatOwnFolder } from "./record-folders";
import { relativeWithin } from "./path-containment";
import { pathExists } from "./path-exists";
import { pathIsWithin } from "./path-is-within";
import { ReadOnlyBaseFs } from "./read-only-base-fs";
import { runtimeLayout } from "./runtime-dir";
import { SETUP_KINDS, setupTrackingFs } from "./setup-changes";
import { type WalkBudget } from "./walk-budget";
import { skillSourceRoots } from "./skills";
import { getWorkspaceConfig } from "./workspace-config";
import { homeDataLayout, workspaceLayout } from "./workspace-layout";
import { workspaceMachineDir } from "./workspace-machine-dir";
export { getWorkspaceSkillsDir } from "./workspace-skills-dir";
export { shellPath } from "./shell-path";

/**
 * Virtual mount point of the device files.
 *
 * Not part of the agent's working surface: it exists so the ordinary shell
 * idiom of redirecting output into a sink resolves instead of failing.
 */
const DEV_MOUNT_POINT = "/dev";

/**
 * The complete filesystem layout for a chat: the chat's work folder,
 * writable, its record folder for what the agent reaches in it, one folder
 * per skill source, and the folders the chat reaches, each writable unless it
 * holds the workspace. Every folder sits at its own
 * host path in the shell's spelling. This is the single source of
 * truth shared by the bash sandbox (just-bash filesystem) and the dedicated
 * file tools, so both agree on what the agent can see and where.
 */
export interface WorkspaceFsLayout {
  /**
   * The workspace's own apps directory, writable, for the agent that authors
   * apps. Absent for a task, which reaches its apps through the `app` command.
   */
  apps?: WorkspaceFsMount & { readOnly: false };
  /** The folders the chat reaches. */
  folders: WorkspaceFsMount[];
  /**
   * What Settings › Permissions, the chat's grants and the app's own rules
   * allow inside those folders. Built with the layout, so every consumer
   * holds to the same rules.
   */
  rules: Rules;
  /**
   * One per skill source, at the source's own directory. The workspace's own
   * skills are writable because authoring one is editing a plain package of
   * files, and everything else -- what the app ships, and what a co-installed
   * agent left in its home directory -- is read-only where it was discovered.
   *
   * Listed whether or not the directory exists, because the layout is built
   * synchronously; `buildBashFs` skips the ones that are not there.
   */
  skills: WorkspaceFsMount[];
  /** The chat's work folder, where the shell starts. */
  chat: WorkspaceFsMount & { hostRoot: WorkDir; readOnly: false };
  /**
   * The chat's record folder, for the two things in it the agent reaches:
   * what the person sent, in `attachments/`, which it reads, and its handoff
   * notes, which it writes. The rest of it is the workspace's and is
   * refused. Absent for the window, which keeps no such records.
   */
  record?: WorkspaceFsMount & { hostRoot: ChatDir; readOnly: false };
  /**
   * Every chat's records, this one's included, read-only: how one chat finds
   * what was said and done in another. Holds the record folder, whose own
   * rules open its attachments and handoff notes as above. Absent for the
   * window.
   */
  chats?: WorkspaceFsMount & { readOnly: false };
  /**
   * The chat's own folder under `Chats/`, which the person sees: where its
   * finished work goes and what they sent it lives. Absent for the window,
   * and for a chat whose settings name no folder yet.
   */
  folder?: WorkspaceFsMount & { readOnly: false };
  /**
   * The system's temp folders, writable, where any program keeps scratch
   * files (the config's, or {@link tempFolders}). Listed whether or not each exists;
   * `buildBashFs` skips the ones that are not there.
   */
  temp: WorkspaceFsMount[];
}

/** A single mount in the workspace filesystem. */
export interface WorkspaceFsMount {
  /** Real on-disk directory backing this mount. */
  hostRoot: AbsolutePath;
  /** The folder's path in the shell's spelling: {@link shellPath} of `hostRoot`. */
  shellRoot: string;
  /**
   * When true the mount is read-only: writes throw EROFS in the shell.
   * A folder is read-only when it overlaps the app's own data
   * ({@link effectiveFolderAccess}).
   */
  readOnly: boolean;
}

/**
 * Build the just-bash filesystem the bash interpreter runs against, from the
 * layout: an empty read-only base holds the root (so a stray write outside
 * every folder fails loudly instead of evaporating with the per-call
 * filesystem), the chat's folder and the temp folders mount writable at their
 * own paths, and the other folders mount with the access each gets.
 */
export async function buildBashFs(
  layout: WorkspaceFsLayout,
  {
    homeWalkBudget,
    listings = { count: 0 },
    maxFileReadSize,
    onRefusal,
  }: {
    /**
     * Counts listings under a folder that holds the workspace (the home
     * folder) against a budget of their own; see `WalkBudget`.
     */
    homeWalkBudget?: WalkBudget;
    /**
     * The listings the command running now has made, which the shell starts
     * over as each command starts.
     */
    listings?: Listings;
    maxFileReadSize: number;
    /** Hears each time the rules refuse the agent a path. */
    onRefusal?: (refusal: string) => void;
  },
): Promise<IFileSystem> {
  const { rules } = layout;
  const outsideFolder = (path: string, op: "read" | "write") => {
    const refusal = outsideFolderRefusal(layout, path, op);
    if (refusal) {
      onRefusal?.(refusal);
    }
    return refusal;
  };

  // Outside every mount the shell reads the disk where the rules allow
  // reading, as a native program does: the system's own folders, a folder no
  // rule holds, a drive once allowed. A place that asks first asks, the
  // app's own data is refused, and nothing there changes. Its listings count
  // against the home folder's smaller budget, so `find /` stops rather than
  // crawling the disk. Windows has no one root to read its drives from, so
  // there a read of a folder outside every mount is refused rather than
  // missing, and says how to reach it.
  const disk =
    process.platform === "win32"
      ? undefined
      : rulesFs({
          delegate: new OverlayFs({
            allowSymlinks: true,
            maxFileReadSize,
            mountPoint: "/",
            readOnly: true,
            root: "/",
          }),
          followsLinks: true,
          hostRoot: "/",
          listings,
          onRefusal,
          rules,
          spell: shellPath,
        });
  const fs = new MountableFs({
    base: new ReadOnlyBaseFs({
      ...(disk && {
        disk: homeWalkBudget ? homeWalkBudget.wrap(disk, "/") : disk,
      }),
      onMissing: (path) =>
        outsideFolder(path, "read") ? "refused" : undefined,
      onWrite: (path) => {
        outsideFolder(path, "write");
      },
    }),
  });

  // just-bash seeds these into its default filesystem, but only for one it can
  // initialize itself -- a mounted layout gets no /dev, so `cmd > /dev/null`
  // dies with EROFS and takes the whole call's output with it. They are plain
  // writable files rather than real devices, which is enough for the
  // redirect-to-discard idiom; the mount is rebuilt per call, so anything
  // written here is dropped when the call ends.
  fs.mount(
    DEV_MOUNT_POINT,
    new InMemoryFs({
      null: "",
      stderr: "",
      stdin: "",
      stdout: "",
      zero: "",
    }),
  );

  // Every folder the agent reaches is mounted at its own path on the disk,
  // and a folder inside another is reached through the outer one, since a
  // mount cannot sit inside another. What the agent may read or change in
  // each is the rules' to say, the app's own folders included: its own data
  // is refused, the skills it ships are read-only, and the chat's folder is
  // open.
  const { links, roots } = await mountRoots(layout);
  for (const mount of roots) {
    const readOnly = mount.readOnly && !holdsWritable(layout, mount);
    // Where the folder really is, which a filesystem over the disk compares
    // every path it is handed against: `/tmp` is a link on macOS.
    const root = canonicalizeThroughMissing(mount.hostRoot) ?? mount.hostRoot;
    let mounted: IFileSystem = readOnly
      ? new OverlayFs({
          maxFileReadSize,
          mountPoint: "/",
          readOnly: true,
          root,
        })
      : new ReadWriteFs({ maxFileReadSize, root });
    // The setup folders this mount reaches, whose writes say what a turn
    // did to the person's skills, apps, topics and memories.
    const setupFolders = (["app", "memory", "skill", "topic"] as const).flatMap(
      (kind) => {
        const within = hostPathWithin(
          mount.hostRoot,
          SETUP_KINDS[kind].folder(),
        );
        return within === null
          ? []
          : [{ kind, root: within === "/" ? "" : within.replace(/\/+$/, "") }];
      },
    );
    if (setupFolders.length > 0) {
      mounted = setupTrackingFs(mounted, setupFolders);
    }
    mounted = rulesFs({
      delegate: mounted,
      hostRoot: mount.hostRoot,
      listings,
      onRefusal,
      rules,
      spell: (hostPath) => shellPath(hostPath),
    });
    fs.mount(
      mount.shellRoot,
      homeWalkBudget && folderHoldsAppData(mount.hostRoot)
        ? homeWalkBudget.wrap(mounted, mount.shellRoot, (path) => {
            // The chat's own folder walks at the sandbox's budget wherever
            // it sits, the home folder included.
            const inChat = hostPathWithin(
              layout.chat.hostRoot,
              nodePath.join(mount.hostRoot, path),
            );
            return inChat !== null;
          })
        : mounted,
    );
  }

  return links.length > 0 ? linkedFs(fs, links) : fs;
}

/** A folder's name in the shell that leads through a link to another. */
interface FolderLink {
  from: string;
  to: string;
}

/**
 * The shell's filesystem with each linked folder's name leading where the
 * link does, as the kernel follows it for a native program. Only the folder
 * named is followed, and what is there is the rules' to say at that path.
 */
function linkedFs(fs: IFileSystem, links: FolderLink[]): IFileSystem {
  const follow = (path: unknown): unknown => {
    if (typeof path !== "string") {
      return path;
    }
    const link = links.find(
      ({ from }) => path === from || path.startsWith(`${from}/`),
    );
    return link ? `${link.to}${path.slice(link.from.length)}` : path;
  };
  return new Proxy(fs, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (
        typeof value !== "function" ||
        key === "resolvePath" ||
        key === "getAllPaths"
      ) {
        return value;
      }
      // The methods naming two paths; a symbolic link's target is its text,
      // never a path to follow. Every other method names one, first.
      const paths =
        key === "cp" || key === "mv" || key === "link"
          ? [0, 1]
          : key === "symlink"
            ? [1]
            : [0];
      return (...args: unknown[]): unknown =>
        Reflect.apply(
          value,
          target,
          args.map((arg, index) => (paths.includes(index) ? follow(arg) : arg)),
        );
    },
  });
}

/**
 * Build the layout for a chat. Synchronous so a path can be resolved against
 * it inline; bash's buildBashFs skips any folder that is missing on disk at
 * mount time.
 *
 * Not pure: a read-write folder is checked against the workspace root, which
 * reads the workspace config and canonicalizes both paths. A caller with no
 * config set can only build a layout whose folders are all read-only.
 */
export function buildWorkspaceFsLayout({
  apps = false,
  folders,
  rules,
  chatHostRoot,
  recordHostRoot,
}: {
  /** Whether the workspace's apps directory is mounted, writable. */
  apps?: boolean;
  folders?: Record<string, MountedFolder.Type>;
  rules?: Rules;
  chatHostRoot: WorkDir;
  /** The chat's record folder; none for the window. */
  recordHostRoot?: ChatDir;
}): WorkspaceFsLayout {
  // The folder the person sees, found from the name the chat's settings
  // hold. Read here rather than passed in, so every caller that builds a
  // layout for a chat gets it without knowing to ask.
  const ownFolder =
    recordHostRoot === undefined ? undefined : chatOwnFolder(recordHostRoot);
  const chatFolderHostRoot = ownFolder;
  const chatsHostRoot = workspaceLayout(getWorkspaceConfig().rootDir).chatsDir;
  const mounts: WorkspaceFsMount[] = Object.values(folders ?? {}).map(
    (folder) => ({
      hostRoot: folder.path,
      shellRoot: shellPath(folder.path),
      // What may change in it is the rules' to say.
      readOnly: false,
    }),
  );

  const layout: Omit<WorkspaceFsLayout, "rules"> & { rules?: Rules } = {
    ...(apps
      ? {
          apps: {
            hostRoot: getWorkspaceConfig().appsDir,
            shellRoot: shellPath(getWorkspaceConfig().appsDir),
            readOnly: false as const,
          },
        }
      : {}),
    folders: mounts,
    ...(rules && { rules }),
    skills: buildSkillMounts(),
    chat: {
      hostRoot: chatHostRoot,
      shellRoot: shellPath(chatHostRoot),
      readOnly: false,
    },
    ...(recordHostRoot && {
      chats: {
        hostRoot: AbsolutePathSchema.parse(chatsHostRoot),
        shellRoot: shellPath(chatsHostRoot),
        // What in it the agent reads or writes is the rules' to say.
        readOnly: false as const,
      },
    }),
    ...(recordHostRoot && {
      record: {
        hostRoot: recordHostRoot,
        shellRoot: shellPath(recordHostRoot),
        // What in it the agent reads or writes is the rules' to say.
        readOnly: false as const,
      },
    }),
    ...(chatFolderHostRoot && {
      folder: {
        hostRoot: chatFolderHostRoot,
        shellRoot: shellPath(chatFolderHostRoot),
        readOnly: false as const,
      },
    }),
    temp: [
      ...(getWorkspaceConfig().tempFolders ?? tempFolders()).map(
        (hostRoot) => ({
          hostRoot,
          shellRoot: shellPath(hostRoot),
          readOnly: false,
        }),
      ),
      // Git Bash's `/tmp` on Windows, where no drive holds a `/tmp`.
      ...(process.platform === "win32" &&
      getWorkspaceConfig().tempFolders === undefined
        ? [
            {
              hostRoot: AbsolutePathSchema.parse(HOST_TMPDIR),
              shellRoot: "/tmp",
              readOnly: false,
            },
          ]
        : []),
    ],
  };
  // Every consumer of the layout (the shell, the file tools, the native
  // sandbox) holds to the same rules, the app's own over its folders among
  // them.
  return { ...layout, rules: layoutRules(layout) };
}

/**
 * The access a folder actually gets: read and write, unless it overlaps the
 * app's own data: one inside this computer's folder for the app, inside
 * the workspace's `.instrument/` or inside `~/.instrument/` but for the
 * work folders, or one holding this computer's folder whole.
 *
 * That folder keeps every workspace's keys, browser profiles and folder
 * rules, so a write grant over it would reach all of them; the rules close it to every command, and the mount is
 * read-only as well. The judgment is about the folder given, not about the
 * mount it sits in: the home folder whole is read-only, since this
 * computer's folder is somewhere inside it, while its Desktop granted on its
 * own carries the grant in full. A folder that only holds the workspace's
 * `.instrument/` (the workspace's own folder, which is the output folder once
 * the person picked it, or the folder holding that) carries its grant too:
 * the rules close `.instrument/` inside it.
 *
 * Applied here rather than at the UI so it holds for a hand-edited
 * settings.json, and shared with the agent's folder list so what the model is
 * told matches what the filesystem enforces.
 *
 * The paths are canonicalized before they are compared, because the overlap
 * is a fact about the directory rather than about how it was spelled: `..`
 * segments and a symlink pointing at the app's data both name it without
 * matching it as a prefix. Only a read-write grant pays for that, so the usual
 * read-only folder costs nothing.
 */
export function effectiveFolderAccess(folder: {
  access: MountedFolder.Access;
  path: string;
}): MountedFolder.Access {
  if (folder.access !== "read-write") {
    return "read-only";
  }
  const config = getWorkspaceConfig();
  const folderPath = canonicalizeThroughMissing(folder.path);
  const userData = canonicalizeThroughMissing(config.userDataDir);
  const workspaceData = canonicalizeThroughMissing(
    workspaceLayout(config.rootDir).dataDir,
  );
  const home = homeDataLayout(os.homedir());
  const homeData = canonicalizeThroughMissing(home.dataDir);
  const workFolders = canonicalizeThroughMissing(home.workDir);
  // A path failing to resolve means the overlap cannot be ruled out, so the
  // grant is refused rather than assumed safe.
  if (
    folderPath === null ||
    userData === null ||
    workspaceData === null ||
    homeData === null ||
    workFolders === null
  ) {
    return "read-only";
  }
  const overlapsAppData =
    pathIsWithin(folderPath, userData) ||
    pathIsWithin(userData, folderPath) ||
    pathIsWithin(folderPath, workspaceData) ||
    (pathIsWithin(folderPath, homeData) &&
      !pathIsWithin(folderPath, workFolders));
  return overlapsAppData ? "read-only" : "read-write";
}

/**
 * True when a folder holds this computer's folder for the app: the home
 * folder, reached whole. Such a folder is read-only as a whole
 * (effectiveFolderAccess) while a folder inside it takes a write grant,
 * which is what a refusal to write it whole should say to do instead.
 */
export function folderHoldsAppData(folderPath: string): boolean {
  const resolved = canonicalizeThroughMissing(folderPath);
  const userData = canonicalizeThroughMissing(getWorkspaceConfig().userDataDir);
  return (
    resolved !== null &&
    userData !== null &&
    resolved !== userData &&
    pathIsWithin(userData, resolved)
  );
}

/** Every folder in the layout but the chat's work folder, in the order they are advertised. */
export function otherFolders(layout: WorkspaceFsLayout): WorkspaceFsMount[] {
  return [
    ...layout.folders,
    ...layout.skills,
    ...(layout.apps ? [layout.apps] : []),
    ...(layout.chats ? [layout.chats] : []),
    ...(layout.record ? [layout.record] : []),
  ];
}

/**
 * Resolve an absolute path in the shell's spelling to the real on-disk path
 * that backs it, plus the mount that owns it. Returns null if no mount owns
 * the path. The longest matching root wins, so a folder inside the chat's
 * folder takes precedence over it.
 */
export function resolveHostPath(
  layout: WorkspaceFsLayout,
  shellAbsPath: string,
): null | { hostPath: AbsolutePath; mount: WorkspaceFsMount } {
  const normalized = normalizePath(shellAbsPath);

  let best: null | { mount: WorkspaceFsMount; relative: string } = null;
  for (const mount of allMounts(layout)) {
    const relative = relativeWithin(mount.shellRoot, normalized);
    if (relative === null) {
      continue;
    }
    if (best === null || mount.shellRoot.length > best.mount.shellRoot.length) {
      best = { mount, relative };
    }
  }

  if (best === null) {
    return null;
  }

  const relativeSegment = best.relative === "/" ? "." : `.${best.relative}`;
  return {
    hostPath: absolutePathJoin(best.mount.hostRoot, relativeSegment),
    mount: best.mount,
  };
}

/**
 * Map a shell path to a host path for a native binary that can only READ.
 *
 * This resolves the whole layout, including the folders the chat reaches and
 * the skills. That is the point: a search command the user cannot point at
 * their folders is not worth having, and the dedicated grep tool already hands
 * real ripgrep those same host paths.
 *
 * The safety of the wider reach rests entirely on the caller, which MUST
 * reject every flag that lets the binary write or execute (for ripgrep:
 * `--pre`, `--pre-glob`, `--hostname-bin`, `-z`/`--search-zip`).
 *
 * Returns null for a path outside every mount, for one the rules keep the
 * agent from reading, and for a symlink that resolves out of its own mount,
 * so the caller reports a clean error rather than reaching the host.
 */
export function resolveReadOnlyHostPath(
  layout: WorkspaceFsLayout,
  shellAbsPath: string,
): AbsolutePath | null {
  const resolved = resolveHostPath(layout, shellAbsPath);
  if (resolved === null) {
    return null;
  }
  const found = classifyHostPath(layout, resolved.hostPath, resolved.mount);
  // The bash sandbox refuses to traverse a symlink out of a mount; a real
  // binary would happily follow it, so the containment has to be re-checked
  // here rather than inherited. Not asked of the chat mount, whose own contents
  // the agent writes and reads by relative path in any case.
  // Nor do the rules reach a real binary on every platform, so a place they
  // keep closed or ask about is refused here too.
  return found === null ||
    (resolved.mount !== layout.chat && found.escapes) ||
    reachOf(layout.rules, resolved.hostPath, "read").level !== "allow"
    ? null
    : resolved.hostPath;
}

/**
 * What a path on the disk is to the agent: the mount it is reached through
 * and its path there, and whether it leaves that mount through a symlink.
 * Null when no mount holds it.
 *
 * The one place these are answered, for every consumer that holds a host
 * path: the person's views of a chat's files, the native hatches that reach
 * mounts (`rg`, `du`, `git`), and the agent's browser. The path is
 * canonicalized once (through a symlink, through missing segments, and
 * without case on a disk that ignores it), so two spellings of one file get
 * one answer.
 *
 * `via` is the mount the path was reached through, when the caller resolved a
 * shell path to get it; without one the deepest mount holding the path is
 * taken, by its spelling first and by where it really leads after.
 */
export function classifyHostPath(
  layout: WorkspaceFsLayout,
  hostPath: string,
  via?: WorkspaceFsMount,
): null | {
  escapes: boolean;
  mount: WorkspaceFsMount;
  shellPath: string;
} {
  const mounts = allMounts(layout);
  const canonical = canonicalizeThroughMissing(hostPath);
  const realRoots = new Map(
    mounts.map((mount) => [mount, realRoot(mount.hostRoot)]),
  );
  const held = (
    candidates: WorkspaceFsMount[],
    rootOf: (mount: WorkspaceFsMount) => null | string,
    target: null | string,
  ) => {
    let best: null | { mount: WorkspaceFsMount; relative: string } = null;
    let bestRoot = "";
    for (const mount of candidates) {
      const root = rootOf(mount);
      const relative =
        root === null || target === null ? null : hostPathWithin(root, target);
      if (relative !== null && root !== null && root.length > bestRoot.length) {
        best = { mount, relative };
        bestRoot = root;
      }
    }
    return best;
  };
  const lexical = held(
    via ? [via] : mounts,
    (mount) => mount.hostRoot,
    hostPath,
  );
  const reached =
    lexical ??
    (via
      ? null
      : held(mounts, (mount) => realRoots.get(mount) ?? null, canonical));
  if (reached === null) {
    return null;
  }
  const ownRoot = realRoots.get(reached.mount);
  return {
    // A path or a root that cannot be resolved cannot be shown to stay inside,
    // so it is taken to leave; a mount whose root is gone holds nothing to
    // leave from.
    escapes:
      canonical === null ||
      ownRoot === null ||
      (ownRoot !== undefined && hostPathWithin(ownRoot, canonical) === null),
    mount: reached.mount,
    shellPath: normalizePath(
      reached.relative === "/"
        ? reached.mount.shellRoot
        : `${reached.mount.shellRoot}${reached.relative}`,
    ),
  };
}

/** All mounts, chat first. */
function allMounts(layout: WorkspaceFsLayout): WorkspaceFsMount[] {
  return [layout.chat, ...otherFolders(layout), ...layout.temp];
}

/**
 * This process's temp folder, read once: the shell refuses a command a look
 * at the environment, and on Windows `/tmp` leads here, as in Git Bash.
 */
const HOST_TMPDIR = os.tmpdir();

/**
 * The system's temp folders, where any program keeps scratch files: `/tmp`
 * and `/var/tmp` on macOS and Linux, and this process's own (`TMPDIR` on
 * macOS, `%TEMP%` on Windows), each as spelled and where it really is.
 */
function tempFolders(): AbsolutePath[] {
  const spelled = [
    ...(process.platform === "win32" ? [] : ["/tmp", "/var/tmp"]),
    os.tmpdir(),
  ];
  const folders = new Set<string>();
  for (const folder of spelled) {
    folders.add(nodePath.resolve(folder));
    const real = canonicalizeThroughMissing(folder);
    if (real !== null) {
      folders.add(real);
    }
  }
  return [...folders].map((folder) => AbsolutePathSchema.parse(folder));
}

/**
 * One mount per skill source, at the source's own directory.
 *
 * Derived from the same source list discovery walks, so a source the agent can
 * load a skill from is a source it can also read and run that skill's files in.
 * The two bundled sources collapse onto one segment backed by the prepared
 * directory: they cannot run from the app bundle, which is signed and replaced
 * wholesale by the updater, so they are materialized once per machine instead.
 */
function buildSkillMounts(): WorkspaceFsMount[] {
  return skillSourceRoots(getWorkspaceConfig()).map(({ dir, readOnly }) => ({
    hostRoot: dir,
    shellRoot: shellPath(dir),
    readOnly,
  }));
}

/**
 * The shell's PATH: system folders it does not mount, which it reads only
 * once its own commands and the programs on the host's PATH have passed on
 * a name.
 */
export const SHELL_PATH = "/usr/local/bin:/usr/bin:/bin";
const SHELL_PATH_DIRS = new Set(SHELL_PATH.split(":"));

/**
 * The programs the shell found on the host's PATH, as the shell spells them.
 * The shell names a program it found by its path afterwards (a command it
 * remembers, `type`), and that look at the program is not the agent asking
 * for its folder.
 */
const foundPrograms = new Set<string>();

/** Records a program the shell found on the host's PATH, by its shell path. */
export function noteFoundProgram(programShellPath: string): void {
  foundPrograms.add(programShellPath);
}

/** Folders that hold the system rather than anything of the person's. */
const SYSTEM_FOLDERS = [
  "/System",
  "/Library",
  "/Applications",
  "/usr",
  "/bin",
  "/sbin",
  "/etc",
  "/private/etc",
  "/opt",
  "/dev",
  "/proc",
  "/sys",
];

/**
 * The host path a shell path names: the inverse of {@link shellPath}. The same
 * path on macOS and Linux; on Windows `/c/Users/sam` becomes `C:\Users\sam`,
 * and `/tmp` is the temp folder, as in Git Bash.
 */
export function hostPathOf(shellSpelled: string): string {
  if (process.platform !== "win32") {
    return shellSpelled;
  }
  const tmp = /^\/tmp(?:\/(.*))?$/.exec(shellSpelled);
  if (tmp) {
    return nodePath.win32.join(HOST_TMPDIR, tmp[1] ?? "");
  }
  const drive = /^\/([A-Za-z])(?:\/(.*))?$/.exec(shellSpelled);
  return drive
    ? `${(drive[1] ?? "").toUpperCase()}:\\${(drive[2] ?? "").replaceAll("/", "\\")}`
    : shellSpelled.replaceAll("/", "\\");
}

/** `\\?\` and `\\.\`, which lift Windows' own parsing of the path after them. */
const EXTENDED_PREFIX = /^[\\/]{2}[?.][\\/]/;

/** A path naming its drive (`C:\Users\sam`, `C:/Users/sam`). */
const DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/;

/**
 * A path naming its drive and hanging off the folder a program runs in on
 * that drive (`C:..\Docs`, `C:work\notes.txt`), which Windows resolves
 * against that folder and not against the drive's root.
 *
 * Only the spellings that can name something outside that folder: one with a
 * step up, or one with a separator. `C:name` on its own resolves to the same
 * file the shell reads `name` as, so leaving it alone costs nothing and keeps
 * a search for `c:something` a search rather than a path.
 */
const DRIVE_RELATIVE = /^[A-Za-z]:(?:\.\.(?:[\\/]|$)|[^\\/]*[\\/])/;

/** A path naming a share (`\\server\share`). */
const SHARE = /^\\\\[^\\/]/;

/**
 * The shell's spelling of an argument that names a path the way this computer
 * does rather than the way the shell does: one naming its drive
 * (`C:\Users\sam`, `C:/Users/sam`), one hanging off the folder the program
 * runs in on that drive (`C:..\Docs`), one naming a share
 * (`\\server\share`), or any of them behind the `\\?\` prefix. Null for
 * every other argument, and for all of them on macOS and Linux, where the
 * shell spells a path as the system does.
 *
 * A program on the disk opens such a path whatever the shell makes of it,
 * which is nothing: it starts with no `/`, so the shell reads it as a name in
 * the working folder, and the rules are asked about a path that is not the
 * one the program opens. A command handing a path to a program resolves the
 * argument here first, so one spelling of a file meets the rules the other
 * meets.
 *
 * A path from the root of the drive a program runs on (`\Users\sam`) is left
 * out: what these commands run rejects it, and it cannot be told from the
 * `\d` or `\b` of a pattern.
 */
export function shellPathOfHostSpelling(
  arg: string,
  {
    hostCwd,
    platform = process.platform,
  }: {
    /** The folder the program runs in, which the rest of a path hangs off. */
    hostCwd: string;
    platform?: NodeJS.Platform;
  },
): null | string {
  if (platform !== "win32") {
    return null;
  }
  const extended = EXTENDED_PREFIX.test(arg);
  const after = arg.replace(EXTENDED_PREFIX, "");
  // `\\?\UNC\server\share` is the share `\\server\share` by another name.
  const named =
    /^UNC[\\/]/i.test(after) && extended ? `\\\\${after.slice(4)}` : after;
  if (
    !DRIVE_ABSOLUTE.test(named) &&
    !SHARE.test(named) &&
    !DRIVE_RELATIVE.test(named)
  ) {
    return null;
  }
  return shellPath(nodePath.win32.resolve(hostCwd, named), platform);
}

/**
 * The rules the layout is held to: the chat's, or where none were given an
 * allow for each folder it reaches, plus the app's own over its folders.
 * The app's own data is closed to every command, and refused plainly: this
 * computer's folder (each workspace's keys, browser profiles and folder
 * rules, and the runtime folder), the workspace's `.instrument/`, its
 * records, `~/.instrument/`, and the updater's downloads in the caches
 * (`appUpdateCaches`). The workspace's own folder around that is
 * the person's, and follows their rules like any folder: once they picked
 * it, it is the output folder. In the app's own data only these open: every
 * chat's work folder, in `~/.instrument/work/`, which chats share as they
 * share everything of the person's; every chat's records, which it reads;
 * and in the chat's record folder the attachments it reads and the handoff
 * notes it writes; the skills it
 * reads and the apps it writes; the runtime's caches and config, which the
 * programs it runs write, and its managed Python, skills, skill
 * environments, preload and `bin` links, which they read; its build
 * folders stay closed. Outside it, the temp folders open, and on Windows
 * the folders under `AppData` programs keep for themselves are readable
 * (`windowsProgramFolders`). A person's rule inside the app's own data opens
 * nothing there, and one on a folder holding it is outranked by the deeper
 * rule that closes it.
 */
function layoutRules(
  layout: Omit<WorkspaceFsLayout, "rules"> & { rules?: Rules },
): Rules {
  const given: Rules = layout.rules ?? {
    home: os.homedir(),
    rules: layout.folders.map((mount) => ({
      level: "allow",
      path: mount.hostRoot,
      source: "grant",
    })),
    dangerouslyAllowEveryFolder: false,
  };
  const system = (level: Rule["level"], path: string): Rule => ({
    level,
    path,
    source: "system",
  });
  const config = getWorkspaceConfig();
  const runtime = runtimeLayout(config.runtimeDir);
  const programs =
    process.platform === "win32" ? windowsProgramFolders(given.home) : [];
  const appData: Rule[] = [
    config.userDataDir,
    workspaceMachineDir(),
    config.runtimeDir,
    workspaceLayout(config.rootDir).dataDir,
    homeDataLayout(given.home).dataDir,
    ...appUpdateCaches(given.home),
  ].map((path) => ({ appData: true, ...system("never", path) }));
  const own: Rule[] = [
    ...appData,
    // Every chat's work folder, in every workspace, so a chat can pick up
    // what another made; the chat's own may be elsewhere (a test's).
    system("allow", homeDataLayout(given.home).workDir),
    system("allow", layout.chat.hostRoot),
    ...(layout.chats ? [system("readOnly", layout.chats.hostRoot)] : []),
    ...(layout.record
      ? [
          system(
            "readOnly",
            nodePath.join(
              layout.record.hostRoot,
              CHAT_FOLDER_NAMES.attachments,
            ),
          ),
          system(
            "allow",
            nodePath.join(layout.record.hostRoot, HANDOFF_NOTES_FILE_NAME),
          ),
        ]
      : []),
    ...layout.skills.map((mount) =>
      system(mount.readOnly ? "readOnly" : "allow", mount.hostRoot),
    ),
    ...(layout.apps ? [system("allow", layout.apps.hostRoot)] : []),
    // The person's drafts, readable and never changed: a draft can ask a
    // computer to send it (its `send`), so one the agent wrote would start a
    // turn nobody asked for.
    system("readOnly", nodePath.join(config.rootDir, DRAFTS_FOLDER_NAME)),
    system("allow", runtime.caches),
    system("allow", runtime.config),
    ...[
      runtime.bin,
      runtime.environments,
      runtime.preload,
      runtime.python,
      runtime.skills,
    ].map((path) => system("readOnly", path)),
    ...layout.temp.map((mount) => system("allow", mount.hostRoot)),
    ...programs.map((folder) => system("readOnly", folder)),
  ];
  // Inside it by name or by where the rule's path really leads: a folder
  // named anywhere that is a link into the app's data opens nothing there.
  const closedRoots = appData.flatMap((closed) => [
    closed.path,
    realHostPath(closed.path),
  ]);
  const outsideAppData = given.rules.filter((rule) => {
    const real = realHostPath(rule.path);
    return !closedRoots.some(
      (closed) =>
        hostPathWithin(closed, rule.path) !== null ||
        hostPathWithin(closed, real) !== null,
    );
  });
  // Each rule names its folder by a path the rules can compare on their own:
  // absolute, and on Windows carrying the drive it is on. The rules resolve
  // every path they compare and do it the first time they are asked, which is
  // inside a command, where just-bash blocks `process.cwd()` -- the one thing
  // Windows' `resolve` has to read for a path that names no drive, so the
  // command dies on a security violation instead of reading the file.
  // Resolved here, before the shell starts.
  return {
    ...given,
    rules: [...outsideAppData, ...own].map((rule) => ({
      ...rule,
      path: nodePath.resolve(rule.path),
    })),
  };
}

/**
 * The app's own data as a walk meets it, each folder where it really is:
 * the folders closed to the agent (`closed`), and the folders and files in
 * them its rules open again (`open`: the chat's work folder, what it was
 * sent, its handoff notes, the skills and apps, the runtime's own folders).
 * A walk the app runs for the agent with nothing else to hold it (`du`'s,
 * and `rg`'s on Windows) leaves out a path whose deepest holder is closed,
 * and goes on through it to what is open.
 */
export function appDataBounds(layout: Pick<WorkspaceFsLayout, "rules">): {
  closed: string[];
  open: string[];
} {
  const closed = layout.rules.rules
    .filter((rule) => rule.appData)
    .map((rule) => realHostPath(rule.path));
  const open = layout.rules.rules
    .filter(
      (rule) =>
        !rule.appData &&
        !rule.dotEntries &&
        (rule.level === "allow" || rule.level === "readOnly"),
    )
    .map((rule) => realHostPath(rule.path))
    .filter((opened) =>
      closed.some(
        (folder) =>
          hostPathWithin(folder, opened) !== null &&
          hostPathWithin(opened, folder) === null,
      ),
    );
  return { closed: [...new Set(closed)], open: [...new Set(open)] };
}

/** The layout's mounts with every one inside another left to the outer. */
async function mountRoots(
  layout: WorkspaceFsLayout,
): Promise<{ links: FolderLink[]; roots: WorkspaceFsMount[] }> {
  const present: WorkspaceFsMount[] = [];
  const missingOurs: WorkspaceFsMount[] = [];
  // The app's own folders are made when missing; a folder of the person's
  // that is gone stays gone rather than coming back empty.
  const ours = [
    layout.chat,
    ...layout.skills.filter((mount) => !mount.readOnly),
    ...(layout.apps ? [layout.apps] : []),
  ];
  for (const mount of allMounts(layout)) {
    if (await pathExists(mount.hostRoot)) {
      present.push(mount);
    } else if (ours.includes(mount)) {
      missingOurs.push(mount);
    }
  }
  // Skills and apps inside a folder that is there already (the workspace's
  // top level, once the person picked it) are reached through it and made
  // by the first skill or app put there, so a workspace that never used them
  // has none. The chat's work folder is always made: the shell starts in it.
  for (const mount of missingOurs) {
    const reached =
      mount !== layout.chat &&
      present.some(
        (outer) =>
          !outer.readOnly &&
          hostPathWithin(outer.hostRoot, mount.hostRoot) !== null,
      );
    if (reached) {
      continue;
    }
    await mkdir(mount.hostRoot, { recursive: true }).catch(() => undefined);
    if (await pathExists(mount.hostRoot)) {
      present.push(mount);
    }
  }
  // A mount at a second name for its folder (`/tmp` on Windows) mounts
  // beside the one at the folder's own path rather than inside it.
  const aliased = (mount: WorkspaceFsMount) =>
    mount.shellRoot !== shellPath(mount.hostRoot);
  // A folder reached through a link inside another mount (`~/work` leading
  // to `~/Documents/work`) mounts where the link leads, since a mount
  // refuses to pass a link, and its own name leads there (`links`). Where it
  // leads is spelled through the mount holding it, as the shell routes it.
  const real = (hostPath: string) =>
    canonicalizeThroughMissing(hostPath) ?? hostPath;
  const leadsElsewhere = (mount: WorkspaceFsMount) =>
    !aliased(mount) &&
    present.some((outer) => {
      const within =
        outer !== mount && !aliased(outer)
          ? hostPathWithin(outer.hostRoot, mount.hostRoot)
          : null;
      return (
        within !== null &&
        real(mount.hostRoot) !== nodePath.join(real(outer.hostRoot), within)
      );
    });
  const linked = present.filter(leadsElsewhere);
  const spelledIn = (realPath: string) => {
    const holder = present
      .filter((mount) => !aliased(mount) && !linked.includes(mount))
      .map((mount) => ({
        mount,
        within: hostPathWithin(real(mount.hostRoot), realPath),
      }))
      .filter(({ within }) => within !== null)
      .toSorted((a, b) => b.mount.hostRoot.length - a.mount.hostRoot.length)
      .at(0);
    return holder?.within
      ? absolutePathJoin(holder.mount.hostRoot, holder.within)
      : AbsolutePathSchema.parse(realPath);
  };
  const links: FolderLink[] = [];
  const resolved = present.map((mount) => {
    if (!linked.includes(mount)) {
      return mount;
    }
    const hostRoot = spelledIn(real(mount.hostRoot));
    links.push({ from: mount.shellRoot, to: shellPath(hostRoot) });
    return { ...mount, hostRoot, shellRoot: shellPath(hostRoot) };
  });
  const outermost = resolved.toSorted(
    (a, b) => a.hostRoot.length - b.hostRoot.length,
  );
  const roots: WorkspaceFsMount[] = [];
  for (const mount of outermost) {
    if (
      aliased(mount) ||
      !roots.some(
        (root) =>
          !aliased(root) && hostPathWithin(root.hostRoot, mount.hostRoot),
      )
    ) {
      roots.push(mount);
    }
  }
  return { links, roots };
}

/** Whether a read-only mount holds one the agent writes, which it reaches through it. */
function holdsWritable(
  layout: WorkspaceFsLayout,
  outer: WorkspaceFsMount,
): boolean {
  return allMounts(layout).some(
    (mount) =>
      mount !== outer &&
      !mount.readOnly &&
      hostPathWithin(outer.hostRoot, mount.hostRoot) !== null,
  );
}

/**
 * What the agent reads about a path in a mount it named that the rules keep
 * from it, naming what to ask for where the folder asks first. Undefined for a
 * path that is open or not there. A path a walk passes is left to the
 * native sandbox, which skips it without asking.
 */
export function operandRefusal(
  layout: WorkspaceFsLayout,
  path: string,
): string | undefined {
  const resolved = resolveHostPath(layout, path);
  if (resolved === null || !existsSync(resolved.hostPath)) {
    return undefined;
  }
  return ruleRefusal({
    hostPath: resolved.hostPath,
    op: "read",
    rules: layout.rules,
    spell: shellPath,
  });
}

/**
 * What the agent reads about a file it named for a program the sandbox does
 * not hold, which reads or writes it as the person: held to the rules as the
 * shell's own commands hold the path, and to them again where it really
 * leads, since that program follows a link out of the folder it sits in.
 * Undefined where the path is open.
 */
export function unsandboxedOperandRefusal(
  layout: WorkspaceFsLayout,
  path: string,
  op: "read" | "write",
): string | undefined {
  const inMount = resolveHostPath(layout, path);
  const hostPath = inMount?.hostPath ?? hostPathOf(path);
  const spelled =
    inMount === null
      ? outsideFolderRefusal(layout, path, op)
      : ruleRefusal({ hostPath, op, rules: layout.rules, spell: shellPath });
  if (spelled !== undefined) {
    return spelled;
  }
  const real = canonicalizeThroughMissing(hostPath);
  return real === null || real === hostPath
    ? undefined
    : ruleRefusal({
        hostPath: real,
        op,
        rules: layout.rules,
        spell: shellPath,
      });
}

/**
 * A path outside every mount that the person could allow: the folder a
 * card names for it, or the nearest one on disk holding that, asked for
 * (never the home folder whole or the disk root), and what the agent reads
 * about it. A change this account
 * could not make whatever the person said asks nothing and says why.
 * Undefined for a read in the system's own folders, a lookup on the shell's
 * PATH, a folder above a mount, and a path nothing on disk holds.
 */
export function outsideFolderRefusal(
  layout: WorkspaceFsLayout,
  path: string,
  op: "read" | "write",
): string | undefined {
  const { rules } = layout;
  // The shell looking a command up on its PATH, or reading a program it
  // found there, is not the agent asking, and a folder above a mount answers
  // as one, which a walk to the mount looks at first.
  if (
    SHELL_PATH_DIRS.has(nodePath.posix.dirname(path)) ||
    (op === "read" && foundPrograms.has(path)) ||
    allMounts(layout).some((mount) =>
      mount.shellRoot.startsWith(`${path === "/" ? "" : path}/`),
    )
  ) {
    return undefined;
  }
  // On Windows a path names its drive (`/c/...`) or a share
  // (`//server/...`); one that does neither is on no disk.
  if (
    process.platform === "win32" &&
    !/^\/(?:[A-Za-z](?:\/|$)|\/)/.test(path)
  ) {
    return `${path} is on no drive. On Windows a path starts with its drive, like /c/Users.`;
  }
  const hostPath = hostPathOf(path);
  // The system's own folders are nothing to ask the person for a look at.
  if (
    op === "read" &&
    SYSTEM_FOLDERS.some((system) => pathIsWithin(hostPath, system))
  ) {
    return undefined;
  }
  const reach = reachOf(rules, hostPath, op);
  // Windows has no one root to read its drives from, so there a path no
  // rule holds is asked for even to read it. Anywhere else, and wherever a
  // rule allows the path (a place or folder set to Allowed in Settings,
  // which the chat reaches as a folder of its own), there is nothing to ask.
  const readsNothing = process.platform === "win32" && !reach.rule;
  if (reach.level === "allow" && !readsNothing) {
    return undefined;
  }
  // A read of a path nothing on disk holds finds it missing, unless the
  // rules close where it would be.
  if (op === "read" && reach.level !== "never" && !existsSync(hostPath)) {
    return undefined;
  }
  return ruleRefusal({
    hostPath,
    isDirectory: existsSync(hostPath) && statSync(hostPath).isDirectory(),
    onDisk: true,
    op,
    reach: reach.level === "allow" ? { level: "ask", rule: reach.rule } : reach,
    rules,
    spell: shellPath,
  });
}
