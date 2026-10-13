import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { describe, expect, it, vi } from "vitest";

import {
  type NativeReach,
  refusalNote,
  refusedPathIn,
  bwrapArgs,
  bwrapAvailable,
  seatbeltAvailable,
  seatbeltProfile,
  wrapNativeCommand,
} from "./native-sandbox";
import { inheritedEnv } from "./native-env";
import { accountCanWrite } from "./permissions/account-can-write";
import { type Rule } from "./permissions/rules";

// The rules below hold a made-up home, which nothing on this disk lets the
// account change; whether it could is the system's answer, set per test.
vi.mock("./permissions/account-can-write", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./permissions/account-can-write")>()),
  accountCanWrite: vi.fn(() => true),
}));

function reachOver(home: string, rules: Rule[]): NativeReach {
  return {
    readOnly: [],
    readWrite: [],
    rules: { home, rules, withoutAsking: false },
  };
}

describe("seatbeltProfile", () => {
  it("closes home to changes, then applies rules shallow to deep", () => {
    const profile = seatbeltProfile(
      reachOver("/nope/home", [
        { level: "allow", path: "/nope/home/Documents/Acme", source: "grant" },
        { level: "ask", path: "/nope/home/Documents", source: "place" },
        { dotEntries: true, level: "ask", path: "/nope/home", source: "place" },
        { level: "never", path: '/nope/home/with "quote"', source: "place" },
      ]),
    );
    expect(
      profile
        .split("\n")
        .filter(
          (line) =>
            !line.includes("/.cache") &&
            !line.includes("Library/") &&
            !/\/\.(npm|local|config|gitconfig)/.test(line),
        ),
    ).toMatchInlineSnapshot(`
      [
        "(version 1)",
        "(allow default)",
        "(deny file-write* (subpath "/nope/home"))",
        "(deny file-read* file-write* (subpath "/nope/home/Documents"))",
        "(deny file-read* file-write* (regex #"^/nope/home/\\.[^/]+(/|$)"))",
        "(deny file-read* file-write* (subpath "/nope/home/with \\"quote\\""))",
        "(allow file-read* file-write* (subpath "/nope/home/Documents/Acme"))",
        "(allow file-read-metadata (literal "/nope"))",
        "(allow file-read-metadata (literal "/nope/home"))",
        "(allow file-read-metadata (literal "/nope/home/Documents"))",
        "(allow file-read-metadata (literal "/nope/home/Library"))",
        "(deny file-write* (literal "/nope"))",
        "(deny file-write* (literal "/nope/home"))",
        "(deny file-write* (require-all (require-any (regex #"/\\.git/hooks(/|$)") (regex #"/\\.gitconfig(/|$)") (regex #"/\\.vscode(/|$)")) ))",
        "(deny appleevent-send)",
        "(deny lsopen)",
        "(deny mach-lookup (global-name "com.apple.coreservices.appleevents"))",
      ]
    `);
  });
});

describe("the passwords place in a profile", () => {
  const home = "/nope/home";
  const socket = "/nope/agent.sock";
  const lines = (rules: Rule[]) =>
    seatbeltProfile(reachOver(home, rules), socket)
      .split("\n")
      .filter((line) => line.includes(socket) || line.includes("Security"));
  const signIns: Rule = {
    level: "ask",
    path: `${home}/.ssh`,
    place: "passwords",
    source: "place",
  };
  const keychains: Rule = {
    level: "never",
    path: `${home}/Library/Keychains`,
    place: "passwords",
    source: "place",
  };

  it("keeps the Keychain service and the ssh-agent closed while .ssh asks", () => {
    expect(lines([signIns, keychains])).toMatchInlineSnapshot(`
      [
        "(deny mach-lookup (global-name "com.apple.SecurityServer") (global-name "com.apple.securityd.xpc"))",
        "(deny network-outbound (literal "/nope/agent.sock"))",
      ]
    `);
  });

  it("opens the ssh-agent with .ssh, and leaves the Keychain closed", () => {
    expect(
      lines([
        signIns,
        keychains,
        { level: "allow", path: `${home}/.ssh`, source: "grant" },
      ]),
    ).toMatchInlineSnapshot(`
      [
        "(deny mach-lookup (global-name "com.apple.SecurityServer") (global-name "com.apple.securityd.xpc"))",
        "(allow file-read* network-outbound (literal "/nope/agent.sock"))",
      ]
    `);
  });

  it("opens the Keychain service when the place is allowed", () => {
    expect(
      lines([
        { ...signIns, level: "allow" },
        { ...keychains, level: "allow" },
      ]),
    ).toMatchInlineSnapshot(`
      [
        "(allow file-read* network-outbound (literal "/nope/agent.sock"))",
      ]
    `);
  });
});

describe("inheritedEnv", () => {
  const env = { PATH: "/usr/bin", SSH_AUTH_SOCK: "/tmp/agent", TOKEN: "t" };
  const home = "/nope/home";
  const signIns: Rule = {
    level: "ask",
    path: `${home}/.ssh`,
    place: "passwords",
    source: "place",
  };

  it.each([
    ["no reach", undefined, false],
    ["rules where .ssh asks", reachOver(home, [signIns]), false],
    [
      "rules with .ssh granted",
      reachOver(home, [
        signIns,
        { level: "allow", path: `${home}/.ssh`, source: "grant" },
      ]),
      true,
    ],
  ])("keeps the ssh-agent's socket for %s: %s", (_name, reach, kept) => {
    expect(inheritedEnv(env, reach)).toEqual({
      PATH: "/usr/bin",
      ...(kept && { SSH_AUTH_SOCK: "/tmp/agent" }),
    });
  });
});

describe("refusedPathIn", () => {
  const reach = reachOver("/Users/someone", [
    { level: "never", path: "/Users/someone/.ssh", source: "place" },
    { level: "ask", path: "/Users/someone/Documents", source: "place" },
  ]);

  it.each([
    ["cat: /Users/someone/.ssh/id_ed25519: Operation not permitted", "never"],
    [
      "PermissionError: [Errno 1] Operation not permitted: '/Users/someone/Documents/Acme/a.csv'",
      "ask",
    ],
    // bubblewrap leaves a closed folder empty, so its refusal reads as missing.
    ["cat: /Users/someone/.ssh/config: No such file or directory", "never"],
    ["cat: /Users/someone/notes.md: No such file or directory", undefined],
  ])("%s", (output, level) => {
    expect(refusedPathIn(output, reach)?.reach.level).toBe(level);
  });

  it.each([
    ["cat: ../Documents/Acme/a.txt: Operation not permitted", "ask"],
    [
      "fatal: cannot change to '../.ssh/keys': Operation not permitted",
      "never",
    ],
    ["cat: notes/a.txt: No such file or directory", undefined],
  ])("reads %s against the cwd", (output, level) => {
    expect(
      refusedPathIn(output, reach, "/Users/someone/Projects")?.reach.level,
    ).toBe(level);
  });

  it("asks for the folder one level into the place", () => {
    const refused = refusedPathIn(
      "Operation not permitted: '/Users/someone/Documents/Acme/a.csv'",
      reach,
    );
    expect(
      refused && refusalNote(refused, "/Users/someone"),
    ).toMatchInlineSnapshot(
      `"~/Documents/Acme/a.csv needs the person's yes first."`,
    );
  });

  it("asks nothing for a change only an administrator could make", () => {
    vi.mocked(accountCanWrite).mockReturnValueOnce(false);
    const refused = refusedPathIn(
      "Operation not permitted: '/Users/someone/Documents/Acme/a.csv'",
      reach,
    );
    expect(
      refused && refusalNote(refused, "/Users/someone"),
    ).toMatchInlineSnapshot(
      `"~/Documents/Acme/a.csv belongs to the system, and only an administrator can change it. Write what you need somewhere you can, or tell the person what you needed it for."`,
    );
  });
});

describe.runIf(seatbeltAvailable())("a wrapped command on this Mac", () => {
  const home = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "native-sandbox-")),
  );
  const closed = path.join(home, "closed");
  const asks = path.join(home, "Documents");
  const granted = path.join(asks, "Acme");
  for (const dir of [closed, granted]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path.join(closed, "key"), "s");
  writeFileSync(path.join(asks, "other.txt"), "o");
  writeFileSync(path.join(granted, "brief.md"), "b");
  writeFileSync(path.join(home, "notes.md"), "n");
  mkdirSync(path.join(home, ".hidden"));
  writeFileSync(path.join(home, ".hidden", "x"), "h");
  const reach = reachOver(home, [
    { level: "never", path: closed, source: "place" },
    { level: "ask", path: asks, source: "place" },
    { dotEntries: true, level: "ask", path: home, source: "place" },
    { level: "allow", path: granted, source: "grant" },
  ]);

  async function run(file: string, args: string[]) {
    const spawned = wrapNativeCommand(file, args, reach);
    expect(spawned.reach).toBeDefined();
    return execa(spawned.file, spawned.args, { reject: false });
  }

  it.each([
    ["reads a file nothing holds", ["cat", path.join(home, "notes.md")], 0],
    ["reads in a granted folder", ["cat", path.join(granted, "brief.md")], 0],
    [
      "writes in a granted folder",
      ["sh", "-c", `echo x > ${path.join(granted, "new")}`],
      0,
    ],
    ["refuses a closed folder", ["cat", path.join(closed, "key")], 1],
    ["refuses a place that asks", ["cat", path.join(asks, "other.txt")], 1],
    ["refuses a hidden folder", ["cat", path.join(home, ".hidden", "x")], 1],
    [
      "refuses a change nothing allows",
      ["sh", "-c", `echo x > ${path.join(home, "new")}`],
      1,
    ],
  ])("%s", async (_name, [command = "", ...args], exitCode) => {
    const result = await run(`/bin/${command}`, args);
    expect(result.exitCode === 0 ? 0 : 1).toBe(exitCode);
  });

  it("writes the temp folder an allow opens, and still closes the home inside it", async () => {
    const temp = realpathSync(os.tmpdir());
    const withTemp = reachOver(home, [
      ...reach.rules.rules,
      { level: "allow", path: temp, source: "system" },
    ]);
    const write = (target: string) => {
      const spawned = wrapNativeCommand(
        "/bin/sh",
        ["-c", `echo x > ${target}`],
        withTemp,
      );
      return execa(spawned.file, spawned.args, { reject: false });
    };
    const scratch = path.join(temp, `native-sandbox-scratch-${process.pid}`);
    expect((await write(scratch)).exitCode).toBe(0);
    rmSync(scratch, { force: true });
    expect((await write(path.join(home, "new"))).exitCode).not.toBe(0);
    expect((await write(path.join(asks, "new"))).exitCode).not.toBe(0);
  });

  it("keeps a closed folder from being carried out by renaming the one above it", async () => {
    const inside = path.join(granted, "Clients");
    const closedInside = path.join(inside, "Payroll");
    mkdirSync(closedInside, { recursive: true });
    writeFileSync(path.join(closedInside, "june.csv"), "p");
    const spawned = wrapNativeCommand(
      "/bin/mv",
      [inside, path.join(granted, "Moved")],
      reachOver(home, [
        ...reach.rules.rules,
        { level: "never", path: closedInside, source: "folder" },
      ]),
    );
    const result = await execa(spawned.file, spawned.args, { reject: false });
    expect(result.exitCode).not.toBe(0);
    expect(existsSync(path.join(granted, "Moved"))).toBe(false);
  });

  it.each([
    [".vscode/tasks.json", ".vscode"],
    [".git/hooks/pre-commit", ".git/hooks"],
  ])("refuses writing %s inside a granted folder", async (file, dir) => {
    mkdirSync(path.join(granted, dir), { recursive: true });
    const spawned = wrapNativeCommand(
      "/bin/sh",
      ["-c", `echo x > ${path.join(granted, file)}`],
      reach,
    );
    const result = await execa(spawned.file, spawned.args, { reject: false });
    expect(result.exitCode).not.toBe(0);
  });

  it("still writes a repository's other files in a granted folder", async () => {
    mkdirSync(path.join(granted, ".git", "objects"), { recursive: true });
    const spawned = wrapNativeCommand(
      "/bin/sh",
      ["-c", `echo x > ${path.join(granted, ".git", "objects", "o")}`],
      reach,
    );
    const result = await execa(spawned.file, spawned.args, { reject: false });
    expect(result.exitCode).toBe(0);
  });

  it("holds a node child the command starts", async () => {
    const result = await run(process.execPath, [
      "-e",
      `require("child_process").execFileSync("/bin/cat", [${JSON.stringify(path.join(closed, "key"))}], { stdio: "inherit" })`,
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Operation not permitted");
  });
});

describe.runIf(bwrapAvailable())("a wrapped command on this Linux", () => {
  const home = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "native-sandbox-")),
  );
  const closed = path.join(home, "closed");
  const asks = path.join(home, "Documents");
  const granted = path.join(asks, "Acme");
  for (const dir of [closed, granted]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path.join(closed, "key"), "s");
  writeFileSync(path.join(asks, "other.txt"), "o");
  writeFileSync(path.join(granted, "brief.md"), "b");
  writeFileSync(path.join(home, "notes.md"), "n");
  mkdirSync(path.join(home, ".hidden"));
  writeFileSync(path.join(home, ".hidden", "x"), "h");
  const reach = reachOver(home, [
    { level: "never", path: closed, source: "place" },
    { level: "ask", path: asks, source: "place" },
    { dotEntries: true, level: "ask", path: home, source: "place" },
    { level: "allow", path: granted, source: "grant" },
  ]);

  it.each([
    ["reads a file nothing holds", `cat ${path.join(home, "notes.md")}`, 0],
    ["reads in a granted folder", `cat ${path.join(granted, "brief.md")}`, 0],
    ["writes in a granted folder", `echo x > ${path.join(granted, "new")}`, 0],
    ["refuses a closed folder", `cat ${path.join(closed, "key")}`, 1],
    ["refuses a place that asks", `cat ${path.join(asks, "other.txt")}`, 1],
    ["refuses a hidden folder", `cat ${path.join(home, ".hidden", "x")}`, 1],
    [
      "refuses a change nothing allows",
      `echo x > ${path.join(home, "new")}`,
      1,
    ],
  ])("%s", async (_name, script, exitCode) => {
    const spawned = wrapNativeCommand("/bin/sh", ["-c", script], reach);
    const result = await execa(spawned.file, spawned.args, { reject: false });
    expect(result.exitCode === 0 ? 0 : 1).toBe(exitCode);
  });
});

describe("bwrapArgs", () => {
  it("refuses a closed folder or file rather than showing it empty", () => {
    const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "bwrap-")));
    for (const folder of ["Documents/Acme", "Secrets"]) {
      mkdirSync(path.join(home, folder), { recursive: true });
    }
    writeFileSync(path.join(home, "secret.txt"), "x");
    const args = bwrapArgs(
      reachOver(home, [
        { level: "ask", path: path.join(home, "Documents"), source: "place" },
        {
          level: "allow",
          path: path.join(home, "Documents/Acme"),
          source: "grant",
        },
        { level: "never", path: path.join(home, "Secrets"), source: "place" },
        {
          level: "never",
          path: path.join(home, "secret.txt"),
          source: "place",
        },
      ]),
    ).join(" ");
    expect(args).toContain(`--perms 0111 --tmpfs ${home}/Documents`);
    expect(args).toContain(`--bind ${home}/Documents/Acme`);
    expect(args).toContain(`--perms 0000 --tmpfs ${home}/Secrets`);
    expect(args).toMatch(
      new RegExp(`--ro-bind \\S*instrument-closed-\\d+ ${home}/secret.txt`),
    );
    rmSync(home, { force: true, recursive: true });
  });
});
