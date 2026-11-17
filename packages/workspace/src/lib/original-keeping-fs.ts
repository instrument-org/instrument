import nodePath from "node:path";

import { type IFileSystem } from "just-bash";

import { MOST_COPIED_BYTES } from "./file-versions";

/**
 * What a file holds before a write first replaces it: its bytes, absent for
 * a path that is not a file yet, a link, or a file too big to copy.
 * Resolves to whether to hand over more, so a turn that takes no more stops
 * the reads.
 */
export type KeepOriginal = (before: {
  bytes?: Uint8Array;
  hostPath: string;
}) => Promise<boolean>;

/**
 * A writable mount's filesystem that hands `keep` what a file holds before
 * the first write in this filesystem's life replaces it, and waits for it,
 * so the turn the write belongs to can be undone. Every write the agent's
 * file tools and its shell's own commands make passes here: `>` and `>>`,
 * `sed -i`, `tee`, and `cp` or `mv` onto a file. A program the shell runs
 * from the PATH (python, node) writes the disk itself and passes by it.
 *
 * The bytes are read through the same filesystem that is about to write
 * them, so a write never yields a copy of anything the agent could not read.
 * Never fails a write: a copy that cannot be made is passed over.
 */
export function originalKeepingFs({
  delegate,
  hostRoot,
  keep,
}: {
  delegate: IFileSystem;
  /** Where the mount is on the disk; paths arrive relative to it. */
  hostRoot: string;
  keep: KeepOriginal;
}): IFileSystem {
  const seen = new Set<string>();
  let wanted = true;
  const before = async (mountPath: string) => {
    const hostPath = nodePath.join(hostRoot, mountPath);
    if (!wanted || seen.has(hostPath)) {
      return;
    }
    seen.add(hostPath);
    try {
      const stat = await delegate.lstat(mountPath).catch(() => undefined);
      const bytes =
        stat?.isFile === true && stat.size <= MOST_COPIED_BYTES
          ? await delegate.readFileBuffer(mountPath)
          : undefined;
      wanted = await keep({ ...(bytes && { bytes }), hostPath });
    } catch {
      // The write goes ahead without a copy.
    }
  };
  /** Where a copy or move lands: in the folder `dest` names, under the source's name. */
  const landing = async (src: string, dest: string) =>
    (await delegate.lstat(dest).catch(() => undefined))?.isDirectory === true
      ? nodePath.posix.join(dest, nodePath.posix.basename(src))
      : dest;
  return new Proxy(delegate, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== "function") {
        return value;
      }
      const call = (...args: unknown[]): unknown =>
        Reflect.apply(value, target, args);
      if (key === "writeFile" || key === "appendFile") {
        return async (...args: unknown[]) => {
          await before(String(args[0]));
          return call(...args);
        };
      }
      if (key === "cp" || key === "mv") {
        return async (...args: unknown[]) => {
          const [src = "", dest = ""] = args.map(String);
          await before(await landing(src, dest));
          return call(...args);
        };
      }
      return call;
    },
  });
}
