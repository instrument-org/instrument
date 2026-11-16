import { execa } from "execa";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { pageRange } from "../shell-commands/office";
import { writeProfileTemplate } from "./profile";
import { namesProfile, sofficeWrapper } from "./run";

let temp: string | undefined;

afterEach(async () => {
  if (temp) {
    await fs.rm(temp, { force: true, recursive: true });
    temp = undefined;
  }
});

describe("namesProfile", () => {
  it.each([
    [["--convert-to", "pdf", "a.docx"], false],
    [["-env:UserInstallation=file:///tmp/p", "--headless"], true],
  ])("%j is %s", (args, expected) => {
    expect(namesProfile(args)).toBe(expected);
  });
});

describe.skipIf(process.platform === "win32")("the soffice wrapper", () => {
  /** A stand-in soffice that prints its arguments and the profile's settings file. */
  async function wrapper() {
    temp = await fs.mkdtemp(path.join(os.tmpdir(), "office-wrapper-test-"));
    const soffice = path.join(temp, "it's soffice");
    await fs.writeFile(
      soffice,
      [
        "#!/bin/sh",
        'for arg in "$@"; do echo "arg:$arg"; done',
        'case "$1" in -env:UserInstallation=file://*) dir="${1#-env:UserInstallation=file://}"; ls "$dir/user" ;; esac',
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const template = path.join(temp, "template");
    await writeProfileTemplate(template);
    const { content, name } = sofficeWrapper({
      profileTemplate: template,
      soffice,
    });
    const file = path.join(temp, name);
    await fs.writeFile(file, content, { mode: 0o755 });
    const tmpdir = path.join(temp, "tmp");
    await fs.mkdir(tmpdir);
    return { file, tmpdir };
  }

  it("runs each call with a fresh copy of the profile, removed after", async () => {
    const { file, tmpdir } = await wrapper();
    const { stdout } = await execa(
      file,
      ["--headless", "--convert-to", "pdf", "a b.docx"],
      { env: { TMPDIR: tmpdir } },
    );
    const lines = stdout.split("\n");
    expect(lines[0]).toMatch(
      new RegExp(
        `^arg:-env:UserInstallation=file://${tmpdir}/office-profile\\.`,
      ),
    );
    expect(lines.slice(1)).toEqual([
      "arg:--headless",
      "arg:--convert-to",
      "arg:pdf",
      "arg:a b.docx",
      "registrymodifications.xcu",
    ]);
    expect(await fs.readdir(tmpdir)).toEqual([]);
  });

  it("leaves a call that names its own profile as it is", async () => {
    const { file, tmpdir } = await wrapper();
    const { stdout } = await execa(
      file,
      ["--headless", "-env:UserInstallation=file:///elsewhere"],
      { env: { TMPDIR: tmpdir }, reject: false },
    );
    expect(stdout.split("\n")).toEqual([
      "arg:--headless",
      "arg:-env:UserInstallation=file:///elsewhere",
    ]);
  });
});

describe("the Windows soffice wrapper", () => {
  it("is a .cmd that copies the profile per call", () => {
    const { content, name } = sofficeWrapper(
      {
        profileTemplate:
          "C:\\Users\\windows-user\\runtime\\office\\26.2.7.3\\profile",
        soffice:
          "C:\\Users\\windows-user\\runtime\\office\\26.2.7.3\\LibreOffice\\program\\soffice.exe",
      },
      "win32",
    );
    expect(name).toBe("soffice.cmd");
    expect(content).toContain('XCOPY /E /I /Q /Y "C:\\Users\\windows-user');
    expect(content).toContain(
      '"-env:UserInstallation=file:///%OFFICE_PROFILE_URL%" %*',
    );
  });
});

describe("pageRange", () => {
  it.each([
    [undefined, [1, 30]],
    ["all", [1, 30]],
    ["3", [3, 3]],
    ["2-5", [2, 5]],
    ["10-100", [10, 39]],
    ["none", null],
  ])("%s → %j", (spec, expected) => {
    expect(pageRange(spec)).toEqual(expected);
  });

  it("refuses a range it cannot read", () => {
    expect(() => pageRange("5-2")).toThrow("--pages takes");
  });
});
