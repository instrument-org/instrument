import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  realpathSync,
  statSync,
} from "node:fs";

import { reachOf } from "../permissions/rules";
import {
  classifyHostPath,
  resolveHostPath,
  shellPathOfHostSpelling,
  type WorkspaceFsLayout,
} from "../workspace-fs-layout";

/**
 * Opening the one file a tier B call names (`unsandboxed-uutils.ts`), so the
 * program reads it as its stdin and opens nothing itself. The shell does
 * what the sandbox would have done for the program, and more strictly:
 * the file is opened only when, after every link is followed, it is a
 * regular file with one name, inside a folder the chat reaches, that the
 * rules let the agent read; and the file opened is the one checked, by its
 * device and inode before and after. Anything else leaves the call to the
 * sandbox, which answers it as it always did.
 */

/**
 * An operand in the shell's spelling. On Windows a program also takes the
 * host's own (`C:\Users\sam\a.txt`, `C:/Users/...`), which becomes
 * `/c/Users/...` as {@link shellPathOfHostSpelling} spells it everywhere
 * else. A device path (`\\?\`, `\\.\`), a share (`\\server\x`), a
 * drive-relative path (`C:a.txt`) or an NTFS stream (`a.txt:s`) is not
 * spelled here, though the shell spells some of them: each names its file
 * through something other than the path checked here (Windows' own parsing
 * lifted, another computer, the folder a program runs in on that drive, a
 * stream the file's name leaves out), so it leaves the call to the sandbox.
 * Undefined for those.
 */
export function shellSpellingOf(
  operand: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform !== "win32") {
    return operand;
  }
  if (/^[A-Za-z]:[\\/]/.test(operand)) {
    return operand.slice(2).includes(":")
      ? undefined
      : (shellPathOfHostSpelling(operand, {
          hostCwd: operand.slice(0, 3),
          platform,
        }) ?? undefined);
  }
  if (/^[\\/]{2}/.test(operand) || operand.includes(":")) {
    return undefined;
  }
  return operand.replaceAll("\\", "/");
}

/** Flags for opening the file: never through a link, never blocking on a FIFO. */
const OPEN_FLAGS =
  constants.O_RDONLY |
  (constants.O_NOFOLLOW ?? 0) |
  (constants.O_NONBLOCK ?? 0);

/**
 * The file a tier B call names, open for reading, or undefined to leave the
 * call to the sandbox. `resolvePath` makes a shell path absolute against the
 * shell's working folder. The caller closes what it gets.
 */
export function openOperandForStdin({
  layout,
  operand,
  platform = process.platform,
  resolvePath,
}: {
  layout: WorkspaceFsLayout;
  operand: string;
  platform?: NodeJS.Platform;
  resolvePath: (path: string) => string;
}): number | undefined {
  const spelled = shellSpellingOf(operand, platform);
  if (spelled === undefined || spelled === "") {
    return undefined;
  }
  const resolved = resolveHostPath(layout, resolvePath(spelled));
  if (resolved === null) {
    return undefined;
  }
  let real: string;
  try {
    real = realpathSync.native(resolved.hostPath);
  } catch {
    return undefined;
  }
  // Where every link leads, which is what the program would read: inside a
  // folder the chat reaches, with no stream name, and open to reading both
  // as named and as reached, which closes the app's own data.
  const target = classifyHostPath(layout, real);
  if (
    !target ||
    (platform === "win32" && real.slice(2).includes(":")) ||
    reachOf(layout.rules, real, "read").level !== "allow" ||
    reachOf(layout.rules, resolved.hostPath, "read").level !== "allow"
  ) {
    return undefined;
  }
  let before;
  try {
    before = statSync(real, { bigint: true });
  } catch {
    return undefined;
  }
  // A second name would let the file be reached from a folder the rules
  // close; a FIFO or device is no file to hand over.
  if (!before.isFile() || before.nlink !== 1n) {
    return undefined;
  }
  let fd: number;
  try {
    // oxlint-disable-next-line studio/no-sync-content-read -- opened to hand to a program as its input, which reads it in its own process.
    fd = openSync(real, OPEN_FLAGS);
  } catch {
    return undefined;
  }
  try {
    const opened = fstatSync(fd, { bigint: true });
    const after = statSync(real, { bigint: true });
    if (
      opened.isFile() &&
      opened.nlink === 1n &&
      opened.dev === before.dev &&
      opened.ino === before.ino &&
      opened.dev === after.dev &&
      opened.ino === after.ino
    ) {
      return fd;
    }
  } catch {
    // Gone or changed while it was opened.
  }
  closeSync(fd);
  return undefined;
}
