import { execa } from "execa";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { TDF_TEAM_ID } from "./manifest";

/**
 * Unpacking TDF's stock builds into a folder, with no installer: the Mac
 * disk image's app copied out, the Windows MSI's administrative install,
 * and the Linux `.deb`s' files taken out without `dpkg`. Each leaves
 * `soffice` somewhere under `dest`, which `findSoffice` finds.
 */

const UNPACK_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * `hdiutil attach`, `ditto` the app out, detach. The copy's folder drops the
 * `.app`: started from a folder named like an app, LibreOffice checks in
 * with Launch Services, which adds it to every Open With menu, registers its
 * Quick Look extensions and Spotlight importer, and shows the person a
 * notice saying so. The signature does not cover the folder's name.
 */
export async function unpackDmg(dmg: string, dest: string): Promise<void> {
  const mount = await fs.mkdtemp(path.join(os.tmpdir(), "office-dmg-"));
  try {
    await execa(
      "/usr/bin/hdiutil",
      [
        "attach",
        "-nobrowse",
        "-readonly",
        "-noautoopen",
        // Its SHA-256 was checked against the pin already.
        "-noverify",
        "-mountpoint",
        mount,
        dmg,
      ],
      { cancelSignal: AbortSignal.timeout(UNPACK_TIMEOUT_MS), stdin: "ignore" },
    );
    try {
      const app = (await fs.readdir(mount)).find((entry) =>
        entry.endsWith(".app"),
      );
      if (!app) {
        throw new Error("the disk image has no app in it");
      }
      await fs.mkdir(dest, { recursive: true });
      await execa(
        "/usr/bin/ditto",
        [path.join(mount, app), path.join(dest, app.replace(/\.app$/, ""))],
        {
          cancelSignal: AbortSignal.timeout(UNPACK_TIMEOUT_MS),
          stdin: "ignore",
        },
      );
    } finally {
      await execa("/usr/bin/hdiutil", ["detach", mount, "-force", "-quiet"], {
        reject: false,
        stdin: "ignore",
      });
    }
  } finally {
    await fs.rm(mount, { force: true, recursive: true }).catch(() => undefined);
  }
}

/** The signature requirement TDF's Mac builds meet: their Developer ID. */
export function tdfSignatureRequirement(team = TDF_TEAM_ID): string {
  return `=anchor apple generic and certificate leaf[subject.OU] = "${team}"`;
}

/**
 * Says why the app is not TDF's, signed whole and unchanged, or nothing
 * when it is.
 */
export async function macSignatureProblem(
  app: string,
): Promise<string | undefined> {
  const result = await execa(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", `-R${tdfSignatureRequirement()}`, app],
    { all: true, reject: false, stdin: "ignore" },
  );
  return result.exitCode === 0
    ? undefined
    : result.all?.trim() || "codesign refused the app";
}

/**
 * The command line of an administrative install, which unpacks the MSI's
 * files under `dest` without installing or registering anything. Built as
 * one verbatim line: msiexec reads `TARGETDIR="…"` itself and refuses the
 * whole argument quoted the way Node quotes one with a space.
 */
export function msiAdminInstallArgs(msi: string, dest: string): string[] {
  return ["/a", `"${msi}"`, "/qn", `TARGETDIR="${dest}"`];
}

export async function unpackMsi(msi: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const result = await execa("msiexec", msiAdminInstallArgs(msi, dest), {
    all: true,
    cancelSignal: AbortSignal.timeout(UNPACK_TIMEOUT_MS),
    reject: false,
    stdin: "ignore",
    windowsVerbatimArguments: true,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `msiexec /a exited ${String(result.exitCode)}${result.all ? `: ${result.all.trim()}` : ""}`,
    );
  }
  await settleMsiImage(dest, path.basename(msi));
}

/**
 * Puts an administrative image in the shape LibreOffice runs from. The
 * image keeps the files a real install puts in Windows' own folders under
 * folders of their own: its bundled fonts (Carlito, Caladea, Liberation,
 * DejaVu) in `Fonts`, which LibreOffice never reads there, so a document set
 * in one of them renders in a stand-in. They go to `share\fonts\truetype`,
 * where LibreOffice loads fonts for itself alone. The Visual C++ runtime
 * the program folder imports (`msvcp140.dll`, `vcruntime140.dll`,
 * `vcruntime140_1.dll` and their kin) comes from a merge module whose
 * components a real install puts in `System32`; the image leaves them in
 * `System64`, where nothing finds them, so on a computer without that
 * runtime installed `soffice` would not start. Those that match
 * `soffice.exe`'s architecture move into `program`, beside what imports
 * them. The arm64 MSI's image holds only the x64 ones (the merge module's
 * x64 and arm64 files share names and one folder), so an arm64 computer
 * still needs the runtime installed. The image also keeps a copy of the
 * MSI, emptied of its files, which nothing reads.
 */
export async function settleMsiImage(
  dest: string,
  msiName: string,
): Promise<void> {
  const fonts = path.join(dest, "Fonts");
  const share = path.join(dest, "share");
  const bundled = path.join(share, "fonts", "truetype");
  if (
    (await isDirectory(fonts)) &&
    (await isDirectory(share)) &&
    !(await isDirectory(bundled))
  ) {
    await fs.mkdir(path.dirname(bundled), { recursive: true });
    await fs.rename(fonts, bundled);
  }
  const program = path.join(dest, "program");
  const system64 = path.join(dest, "System64");
  const machine = await peMachine(path.join(program, "soffice.exe"));
  if (machine !== undefined && (await isDirectory(system64))) {
    for (const name of await fs.readdir(system64)) {
      const from = path.join(system64, name);
      const to = path.join(program, name);
      if (
        name.toLowerCase().endsWith(".dll") &&
        !existsSync(to) &&
        (await peMachine(from)) === machine
      ) {
        await fs.rename(from, to);
      }
    }
  }
  await fs.rm(path.join(dest, msiName), { force: true });
}

/**
 * The machine a Windows executable or DLL is built for, from its PE header
 * (`0x8664` x64, `0xaa64` arm64, `0x14c` x86), or nothing when the file is
 * not one.
 */
export async function peMachine(file: string): Promise<number | undefined> {
  const handle = await fs.open(file, "r").catch(() => undefined);
  if (!handle) {
    return undefined;
  }
  try {
    const head = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    if (bytesRead < 0x40 || head.toString("latin1", 0, 2) !== "MZ") {
      return undefined;
    }
    const pe = head.readUInt32LE(0x3c);
    return pe + 6 <= bytesRead &&
      head.toString("latin1", pe, pe + 4) === "PE\0\0"
      ? head.readUInt16LE(pe + 4)
      : undefined;
  } finally {
    await handle.close();
  }
}

async function isDirectory(dir: string): Promise<boolean> {
  return fs
    .stat(dir)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
}

/** One member of an `ar` archive, the format a `.deb` is. */
type ArMember = { name: string; offset: number; size: number };

/** The members of an `ar` archive, read from its headers. */
export function arMembers(archive: Buffer): ArMember[] {
  if (archive.toString("latin1", 0, 8) !== "!<arch>\n") {
    throw new Error("not an ar archive");
  }
  const members: ArMember[] = [];
  let at = 8;
  while (at + 60 <= archive.length) {
    const name = archive
      .toString("latin1", at, at + 16)
      .trim()
      .replace(/\/$/, "");
    const size = Number(archive.toString("latin1", at + 48, at + 58).trim());
    if (!Number.isFinite(size)) {
      throw new Error("damaged ar header");
    }
    members.push({ name, offset: at + 60, size });
    // Members start on an even byte.
    at += 60 + size + (size % 2);
  }
  return members;
}

/**
 * Unpacks every `.deb` in TDF's tarball into `dest` the way `dpkg` would
 * lay out their files, with nothing installed: the tarball by `tar`, each
 * `.deb`'s `data.tar.*` taken out of its `ar` archive, then by `tar`.
 */
export async function unpackDebTarball(
  tarball: string,
  dest: string,
): Promise<void> {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "office-deb-"));
  try {
    await execa("tar", ["-xzf", tarball, "-C", work], {
      cancelSignal: AbortSignal.timeout(UNPACK_TIMEOUT_MS),
      stdin: "ignore",
    });
    const debs = (await fs.readdir(work, { recursive: true }))
      .filter((entry) => entry.endsWith(".deb"))
      .map((entry) => path.join(work, entry));
    if (debs.length === 0) {
      throw new Error("the archive has no .deb packages in it");
    }
    await fs.mkdir(dest, { recursive: true });
    for (const deb of debs) {
      await unpackDeb(deb, dest, work);
    }
  } finally {
    await fs.rm(work, { force: true, recursive: true });
  }
}

async function unpackDeb(
  deb: string,
  dest: string,
  scratch: string,
): Promise<void> {
  const archive = await fs.readFile(deb);
  const data = arMembers(archive).find((member) =>
    member.name.startsWith("data.tar"),
  );
  if (!data) {
    throw new Error(`${path.basename(deb)} has no data.tar`);
  }
  const member = path.join(scratch, `${path.basename(deb)}-${data.name}`);
  await fs.writeFile(
    member,
    archive.subarray(data.offset, data.offset + data.size),
  );
  // tar reads gzip, xz and zstd by what the file starts with.
  await execa("tar", ["-xf", member, "-C", dest], {
    cancelSignal: AbortSignal.timeout(UNPACK_TIMEOUT_MS),
    stdin: "ignore",
  });
  await fs.rm(member, { force: true });
}

/**
 * Where `soffice` is under an unpacked build, as a path relative to `root`:
 * the Mac app's, the Linux `opt/libreoffice<major>/program`'s, or the MSI's
 * `program` folder, wherever the administrative install put it.
 */
export async function findSoffice(
  root: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const wanted =
    platform === "darwin"
      ? /(^|\/)[^/]+\/Contents\/MacOS\/soffice$/
      : platform === "win32"
        ? /(^|\/)program\/soffice\.exe$/i
        : /(^|\/)program\/soffice$/;
  const entries = await fs.readdir(root, { recursive: true }).catch(() => []);
  return entries
    .map((entry) => entry.split(path.sep).join("/"))
    .filter((entry) => wanted.test(entry))
    .sort((a, b) => a.split("/").length - b.split("/").length)[0];
}

/** The file's SHA-256, read as a stream. */
export async function sha256Of(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}
