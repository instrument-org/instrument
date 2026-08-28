import { Bash, InMemoryFs } from "just-bash";
import { describe, expect, it } from "vitest";

import { MOUNT } from "../../mount-points";
import { createMktempCommand } from "./mktemp";

const TMP_DIR = `${MOUNT.task}/work/tmp`;

async function makeBash() {
  const fs = new InMemoryFs();
  await fs.mkdir(MOUNT.task, { recursive: true });
  return new Bash({
    commands: ["cat", "echo", "ls", "stat"],
    customCommands: [createMktempCommand()],
    cwd: MOUNT.task,
    fs,
  });
}

describe("mktemp", () => {
  it("creates a file under work/ and prints its path", async () => {
    const bash = await makeBash();
    const result = await bash.exec('f=$(mktemp); echo "$f"; test -f "$f"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(
      new RegExp(`^${TMP_DIR}/tmp\\.[\\dA-Za-z]{10}$`),
    );
  });

  it("returns a different name each time", async () => {
    const bash = await makeBash();
    const result = await bash.exec("mktemp; mktemp");
    const [first, second] = result.stdout.trim().split("\n");
    expect(first).not.toBe(second);
  });

  it("creates a directory with -d", async () => {
    const bash = await makeBash();
    const result = await bash.exec('d=$(mktemp -d); test -d "$d" && echo dir');
    expect(result.stdout.trim()).toBe("dir");
  });

  it("leaves nothing behind with -u", async () => {
    const bash = await makeBash();
    const result = await bash.exec(
      'u=$(mktemp -u); test -e "$u" && echo exists || echo absent',
    );
    expect(result.stdout.trim()).toBe("absent");
  });

  it("writes the file where a native binary can also reach it", async () => {
    const bash = await makeBash();
    // The path has to be one the argv bridge maps, which is the whole reason
    // this lives under the task rather than at /tmp.
    const result = await bash.exec("mktemp");
    expect(result.stdout.trim().startsWith(`${MOUNT.task}/`)).toBe(true);
  });

  it("resolves a bare template against the working directory, as GNU does", async () => {
    const bash = await makeBash();
    const result = await bash.exec("mktemp note.XXXXXX");
    expect(result.stdout.trim()).toMatch(
      new RegExp(`^${MOUNT.task}/note\\.[\\dA-Za-z]{6}$`),
    );
  });

  it("places a bare template in the temp dir with -t", async () => {
    const bash = await makeBash();
    const result = await bash.exec("mktemp -t note.XXXXXX");
    expect(result.stdout.trim()).toMatch(
      new RegExp(`^${TMP_DIR}/note\\.[\\dA-Za-z]{6}$`),
    );
  });

  it("honors a template that names its own directory", async () => {
    const bash = await makeBash();
    const result = await bash.exec("mktemp /task/work/held.XXXX");
    expect(result.stdout.trim()).toMatch(
      new RegExp(`^${MOUNT.task}/work/held\\.[\\dA-Za-z]{4}$`),
    );
  });

  it("rejects a template with too few X's", async () => {
    const bash = await makeBash();
    const result = await bash.exec("mktemp bad.XX");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("too few X's");
  });

  // GNU's -q covers creation failure only, so a malformed template still
  // reports. Checked against coreutils 9.2.
  it("still reports a bad template under -q", async () => {
    const bash = await makeBash();
    const result = await bash.exec("mktemp -q bad.XX");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("too few X's");
  });

  it.each([
    ["mktemp", "600"],
    ["mktemp -d", "700"],
  ])("creates what `%s` returns with mode %s", async (command, mode) => {
    const bash = await makeBash();
    const result = await bash.exec(`p=$(${command}); stat -c '%a' "$p"`);
    expect(result.stdout.trim()).toBe(mode);
  });

  it("reports an unknown option", async () => {
    const bash = await makeBash();
    const result = await bash.exec("mktemp -Z");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid option");
  });
});
