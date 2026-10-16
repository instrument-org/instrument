import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { classifyUnsandboxed } from "./unsandboxed-uutils";
import { unsandboxedEnv } from "./unsandboxed-uutils-env";

/**
 * The canary for what the rules in `unsandboxed-uutils.ts` assume: a call
 * they let run outside the sandbox opens no file. Each corpus call runs the
 * real binary twice the way the shell runs it unsandboxed (its tier's
 * arguments, the fixed environment, a tier B file as stdin), once plainly
 * and once under a Seatbelt profile that refuses reading any file but the
 * binary's own folder and the system's libraries and time zones. A uutils
 * release that starts reading a file of its own, or a rule that lets
 * through an option that opens one, prints something different here.
 */
const UUTILS_DIR = path.resolve(
  import.meta.dirname,
  "../../../../../apps/studio/resources/uutils",
);
const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const runs =
  process.platform === "darwin" &&
  existsSync(SANDBOX_EXEC) &&
  existsSync(path.join(UUTILS_DIR, "coreutils"));

const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "uutils-canary-")));
const lines = Array.from(
  { length: 2000 },
  (_, i) => `w${(i * 7919) % 97} ${i}`,
);
writeFileSync(path.join(dir, "words.txt"), `${lines.join("\n")}\n`);
writeFileSync(path.join(dir, "nums.txt"), "10\n1e3\n2.5\n-1\n2K\n");
afterAll(() => rmSync(dir, { force: true, recursive: true }));

const sbpl = (value: string) => JSON.stringify(value);

/** Every file read refused but the binaries' folder and the system's own. */
const DENY_ALL = [
  "(version 1)",
  "(allow default)",
  "(deny file-read* file-write*)",
  // Looking a path up (stat) is not reading what is in it; jiff walks the
  // folders above a zone file.
  "(allow file-read-metadata)",
  `(allow file-read* (subpath ${sbpl(realpathSync(UUTILS_DIR))}) (subpath "/usr/lib") (subpath "/System") (subpath "/usr/share/zoneinfo") (subpath "/private/var/db/timezone") (literal "/private/etc/localtime") (literal "/dev/null") (literal "/"))`,
].join("\n");

/** Calls the rules let out of the sandbox, with the file a tier B call reads. */
const CORPUS: string[][] = [
  ["head", "-n", "3", "words.txt"],
  ["head", "-5"],
  ["head", "-c", "20", "words.txt"],
  ["tail", "-n", "+1990", "words.txt"],
  ["tail", "-3", "words.txt"],
  ["sort", "-u", "nums.txt"],
  ["sort", "-g", "nums.txt"],
  ["sort", "-h", "nums.txt"],
  ["sort", "-t", " ", "-k2,2nr", "words.txt"],
  ["sort", "-rn"],
  ["uniq", "-c", "nums.txt"],
  ["cut", "-d", " ", "-f", "1", "words.txt"],
  ["wc", "-l", "words.txt"],
  ["wc", "-c"],
  ["wc"],
  ["grep", "-c", "w1", "words.txt"],
  ["grep", "-n", "w9 ", "words.txt"],
  ["grep", "-H", "-m", "2", "w5", "words.txt"],
  ["grep", "-e", "w2"],
  ["od", "-c", "nums.txt"],
  ["base32", "nums.txt"],
  ["basenc", "--base16", "nums.txt"],
  ["fmt", "-w", "30", "nums.txt"],
  ["md5sum"],
  ["sha256sum", "-b"],
  ["cksum"],
  ["seq", "-s", ",", "5"],
  ["factor", "360"],
  ["numfmt", "--to=si", "123456"],
  ["date", "-u", "-d", "@0", "+%F %T %Z"],
  ["date", "-d", "@86400", "+%F %Z"],
  ["uname", "-s"],
  ["nproc"],
  ["id", "-u"],
  ["shuf", "-i", "1-1", "-n", "1"],
];

/** A call as the shell runs it unsandboxed, then that under DENY_ALL. */
function runBoth(name: string, args: string[]) {
  const tier = classifyUnsandboxed(name, args);
  if (tier.tier === "sandbox") {
    throw new Error(`${name} ${args.join(" ")} is not in the corpus's tiers`);
  }
  const file = path.join(UUTILS_DIR, name === "grep" ? "grep" : "coreutils");
  const argv = [
    ...(name === "grep" ? [] : [name]),
    ...(tier.tier === "B" ? tier.argv : args),
  ];
  const input = tier.tier === "B" ? tier.operand : "words.txt";
  const env = unsandboxedEnv(
    { LANG: "en_US.UTF-8", TZ: "America/Chicago" },
    { tempDir: () => dir },
  );
  const spawn = (command: string, commandArgs: string[]) => {
    const fd = openSync(path.join(dir, input), "r");
    try {
      const { status, stderr, stdout } = spawnSync(command, commandArgs, {
        cwd: dir,
        encoding: "utf8",
        env,
        stdio: [fd, "pipe", "pipe"],
      });
      return { status, stderr, stdout };
    } finally {
      closeSync(fd);
    }
  };
  return {
    denied: spawn(SANDBOX_EXEC, ["-p", DENY_ALL, file, ...argv]),
    plain: spawn(file, argv),
  };
}

describe.runIf(runs)("unsandboxed uutils under a deny-all profile", () => {
  it.each(CORPUS)("%s %s prints the same", (name = "", ...args) => {
    const { denied, plain } = runBoth(name, args);
    expect(plain.status).toBe(0);
    expect(denied).toEqual(plain);
  });

  it("notices a call that opens a file", () => {
    // The profile works: a file named to the program is refused.
    const file = path.join(UUTILS_DIR, "coreutils");
    const { stderr, status } = spawnSync(
      SANDBOX_EXEC,
      ["-p", DENY_ALL, file, "head", "-1", "words.txt"],
      { cwd: dir, encoding: "utf8" },
    );
    expect({ status, stderr }).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "head: cannot open 'words.txt' for reading: Permission denied
      ",
      }
    `);
  });
});
