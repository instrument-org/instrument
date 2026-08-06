import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";

/**
 * A real directory for one test, removed when it ends.
 *
 * Real rather than mocked, because most of what this package does to a
 * filesystem it does through a subprocess -- ffmpeg, rg, uv, pnpm, git -- and
 * those make their own syscalls against the actual kernel. No in-process fs
 * mock reaches them, so a test that mocks the filesystem out from under a tool
 * is testing a tool that never ran. Path containment has the same problem from
 * the other side: it is enforced against real `realpath` semantics, which an
 * emulated symlink only approximates.
 *
 * The path is resolved through `realpath` because a temp dir is usually reached
 * by one. On macOS `os.tmpdir()` is `/var/folders/...`, a symlink to
 * `/private/var/folders/...`, and code that resolves a path before comparing it
 * to a configured root would see the two disagree and call it an escape.
 *
 * ```ts
 * const root = withTempDir("generate-image");
 * it("writes something", async () => {
 *   await fs.writeFile(path.join(root.path, "note.txt"), "hi");
 * });
 * ```
 */
export function withTempDir(prefix: string) {
  const dir = { path: "" };

  beforeEach(async () => {
    dir.path = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`)),
    );
  });

  afterEach(async () => {
    await fs.rm(dir.path, { force: true, recursive: true });
  });

  return dir;
}
