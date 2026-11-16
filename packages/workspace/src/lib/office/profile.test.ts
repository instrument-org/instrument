import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  freshProfile,
  profileKeepsSettings,
  profileUrl,
  registryFile,
  registryModifications,
  writeProfileTemplate,
} from "./profile";

let temp: string | undefined;

afterEach(async () => {
  if (temp) {
    await fs.rm(temp, { force: true, recursive: true });
    temp = undefined;
  }
});

async function tempDir() {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "office-profile-test-"));
  return temp;
}

describe("the profile template", () => {
  it("forces recalculation on load, keeps macros off and never updates links", () => {
    expect(registryModifications()).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
      <item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="ODFRecalcMode" oor:op="fuse"><value>0</value></prop></item>
      <item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
      <item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
      <item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
      <item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>1</value></prop></item>
      <item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item>
      </oor:items>
      "
    `);
  });

  it("is written where LibreOffice reads a profile's settings", async () => {
    const dir = await tempDir();
    await writeProfileTemplate(dir);
    expect(
      await fs.readFile(
        path.join(dir, "user", "registrymodifications.xcu"),
        "utf8",
      ),
    ).toBe(registryModifications());
    expect(await profileKeepsSettings(dir)).toBe(true);
  });

  it("notices a setting LibreOffice rewrote on exit", async () => {
    const dir = await tempDir();
    await writeProfileTemplate(dir);
    const file = registryFile(dir);
    await fs.writeFile(
      file,
      (await fs.readFile(file, "utf8")).replace(
        '"OOXMLRecalcMode" oor:op="fuse"><value>0',
        '"OOXMLRecalcMode" oor:op="fuse"><value>1',
      ),
    );
    expect(await profileKeepsSettings(dir)).toBe(false);
  });

  it("gives each call a copy of its own, removed after", async () => {
    const dir = await tempDir();
    const template = path.join(dir, "template");
    await writeProfileTemplate(template);
    const [one, two] = await Promise.all([
      freshProfile(template, dir),
      freshProfile(template, dir),
    ]);
    expect(one.dir).not.toBe(two.dir);
    expect(one.url).toBe(profileUrl(one.dir));
    expect(one.url.startsWith("file://")).toBe(true);
    expect(await fs.readFile(registryFile(one.dir), "utf8")).toBe(
      registryModifications(),
    );
    await one.dispose();
    await expect(fs.stat(one.dir)).rejects.toThrow();
    await expect(fs.stat(two.dir)).resolves.toBeDefined();
  });
});
