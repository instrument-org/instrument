import { execa } from "execa";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  arMembers,
  findSoffice,
  msiAdminInstallArgs,
  sha256Of,
  tdfSignatureRequirement,
  unpackDebTarball,
  unpackDmg,
} from "./unpack";

let temp: string | undefined;

afterEach(async () => {
  if (temp) {
    await fs.rm(temp, { force: true, recursive: true });
    temp = undefined;
  }
});

async function tempDir() {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "office-unpack-test-"));
  return temp;
}

/** An `ar` archive of `members`, the way `dpkg-deb` writes a `.deb`. */
function arArchive(members: [string, Buffer][]): Buffer {
  const parts: Buffer[] = [Buffer.from("!<arch>\n", "latin1")];
  for (const [name, data] of members) {
    const header =
      `${name}/`.padEnd(16) +
      "0".padEnd(12) +
      "0".padEnd(6) +
      "0".padEnd(6) +
      "100644".padEnd(8) +
      String(data.length).padEnd(10) +
      "`\n";
    parts.push(Buffer.from(header, "latin1"), data);
    if (data.length % 2) {
      parts.push(Buffer.from("\n"));
    }
  }
  return Buffer.concat(parts);
}

/** A `.deb` whose `data.tar.xz` lays out `files` from the root. */
async function debOf(dir: string, files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(dir, "root-"));
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), content);
  }
  const data = path.join(dir, `data-${path.basename(root)}.tar.xz`);
  await execa("tar", ["-cJf", data, "-C", root, "."]);
  return arArchive([
    ["debian-binary", Buffer.from("2.0\n")],
    ["control.tar.gz", Buffer.alloc(3, 1)],
    ["data.tar.xz", await fs.readFile(data)],
  ]);
}

describe("arMembers", () => {
  it("reads each member's name and place, odd sizes padded", () => {
    const archive = arArchive([
      ["debian-binary", Buffer.from("2.0\n")],
      ["odd", Buffer.from("abc")],
      ["data.tar.xz", Buffer.from("payload")],
    ]);
    const members = arMembers(archive);
    expect(members.map(({ name, size }) => [name, size])).toEqual([
      ["debian-binary", 4],
      ["odd", 3],
      ["data.tar.xz", 7],
    ]);
    const data = members[2];
    expect(
      data && archive.toString("latin1", data.offset, data.offset + data.size),
    ).toBe("payload");
  });

  it("refuses what is not an ar archive", () => {
    expect(() => arMembers(Buffer.from("PK\u0003\u0004"))).toThrow(
      "not an ar archive",
    );
  });
});

describe.skipIf(process.platform === "win32")("unpackDebTarball", () => {
  it("lays out every .deb's files as dpkg would, without dpkg", async () => {
    const dir = await tempDir();
    const debs = path.join(
      dir,
      "LibreOffice_26.2.7.3_Linux_x86-64_deb",
      "DEBS",
    );
    await fs.mkdir(debs, { recursive: true });
    await fs.writeFile(
      path.join(debs, "libreoffice26.2-core.deb"),
      await debOf(dir, {
        "opt/libreoffice26.2/program/soffice": "#!/bin/sh\n",
      }),
    );
    await fs.writeFile(
      path.join(debs, "libreoffice26.2-calc.deb"),
      await debOf(dir, {
        "opt/libreoffice26.2/program/libsclo.so": "calc",
      }),
    );
    const tarball = path.join(dir, "LibreOffice.tar.gz");
    await execa("tar", [
      "-czf",
      tarball,
      "-C",
      dir,
      "LibreOffice_26.2.7.3_Linux_x86-64_deb",
    ]);
    const dest = path.join(dir, "out");
    await unpackDebTarball(tarball, dest);
    expect(await findSoffice(dest, "linux")).toBe(
      "opt/libreoffice26.2/program/soffice",
    );
    expect(
      await fs.readFile(
        path.join(dest, "opt/libreoffice26.2/program/libsclo.so"),
        "utf8",
      ),
    ).toBe("calc");
  });

  it("says so when the archive holds no packages", async () => {
    const dir = await tempDir();
    await fs.mkdir(path.join(dir, "empty"));
    const tarball = path.join(dir, "empty.tar.gz");
    await execa("tar", ["-czf", tarball, "-C", dir, "empty"]);
    await expect(
      unpackDebTarball(tarball, path.join(dir, "out")),
    ).rejects.toThrow("no .deb packages");
  });
});

describe.skipIf(process.platform !== "darwin")("unpackDmg", () => {
  it("copies the app out of the disk image under a name no app has, and detaches it", async () => {
    const dir = await tempDir();
    const source = path.join(dir, "source");
    const macos = path.join(source, "LibreOffice.app", "Contents", "MacOS");
    await fs.mkdir(macos, { recursive: true });
    await fs.writeFile(path.join(macos, "soffice"), "#!/bin/sh\n");
    await fs.symlink("/Applications", path.join(source, "Applications"));
    const dmg = path.join(dir, "fixture.dmg");
    await execa("/usr/bin/hdiutil", [
      "create",
      "-quiet",
      "-fs",
      "HFS+",
      "-volname",
      "LibreOffice",
      "-srcfolder",
      source,
      "-format",
      "UDZO",
      dmg,
    ]);
    const dest = path.join(dir, "out");
    await unpackDmg(dmg, dest);
    expect(await findSoffice(dest, "darwin")).toBe(
      "LibreOffice/Contents/MacOS/soffice",
    );
    const { stdout } = await execa("/usr/bin/hdiutil", ["info"]);
    expect(stdout).not.toContain(dmg);
  }, 60_000);
});

describe("the Windows administrative install", () => {
  it("unpacks the MSI under the folder with nothing installed or asked", () => {
    expect(
      msiAdminInstallArgs(
        "C:\\Users\\windows-user\\AppData\\Local\\x\\LibreOffice.msi",
        "C:\\Users\\windows-user\\AppData\\Roaming\\Instrument\\runtime\\office\\.26.2.7.3.building",
      ),
    ).toEqual([
      "/a",
      '"C:\\Users\\windows-user\\AppData\\Local\\x\\LibreOffice.msi"',
      "/qn",
      'TARGETDIR="C:\\Users\\windows-user\\AppData\\Roaming\\Instrument\\runtime\\office\\.26.2.7.3.building"',
    ]);
  });

  it("finds soffice.exe in the program folder it leaves", async () => {
    const dir = await tempDir();
    await fs.mkdir(path.join(dir, "LibreOffice", "program"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(dir, "LibreOffice", "program", "soffice.exe"),
      "",
    );
    await fs.writeFile(
      path.join(dir, "LibreOffice", "program", "soffice.com"),
      "",
    );
    expect(await findSoffice(dir, "win32")).toBe(
      "LibreOffice/program/soffice.exe",
    );
  });
});

describe("checks", () => {
  it("asks codesign for TDF's Developer ID", () => {
    expect(tdfSignatureRequirement()).toBe(
      '=anchor apple generic and certificate leaf[subject.OU] = "7P5S3ZLCN7"',
    );
  });

  it("hashes a file as sha256sum does", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "a");
    await fs.writeFile(file, "abc");
    expect(await sha256Of(file)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
