import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { afterAll, describe, expect, it, vi } from "vitest";

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
import { ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { inheritedEnv } from "./native-env";
import { accountCanWrite } from "./permissions/account-can-write";
import { raiseAsk } from "./permissions/asks";
import { reachOf, type Rule } from "./permissions/rules";
import { runtimeLayout } from "./runtime-dir";
import { getWorkspaceConfig } from "./workspace-config";

// The rules below hold a made-up home, which nothing on this disk lets the
// account change; whether it could is the system's answer, set per test.
vi.mock("./permissions/account-can-write", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./permissions/account-can-write")>()),
  accountCanWrite: vi.fn(() => true),
}));

vi.mock("./permissions/asks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./permissions/asks")>()),
  raiseAsk: vi.fn(),
}));

// Windows runs native commands with no Seatbelt or bubblewrap profile, so
// nothing there builds one or reads the refusals of a command held by one.
const onWindows = process.platform === "win32";

function reachOver(home: string, rules: Rule[]): NativeReach {
  return {
    readOnly: [],
    readWrite: [],
    rules: { home, rules, withoutAsking: false },
  };
}

describe.skipIf(onWindows)("seatbeltProfile", () => {
  it("closes the disk and home to changes, then applies rules shallow to deep", () => {
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
            !line.includes("/var/folders") &&
            !/\/\.(npm|local|config|gitconfig)/.test(line),
        ),
    ).toMatchInlineSnapshot(`
      [
        "(version 1)",
        "(allow default)",
        "(deny file-write* (subpath "/"))",
        "(allow file-write* (subpath "/dev"))",
        "(deny file-write* (subpath "/nope/home"))",
        "(deny file-read* file-write* (regex #"^/nope/home/\\.[^/]+(/|$)"))",
        "(deny file-read* file-write* (subpath "/nope/home/Documents"))",
        "(deny file-read* file-write* network-outbound (subpath "/nope/home/with \\"quote\\""))",
        "(allow file-read* file-write* network-outbound (subpath "/nope/home/Documents/Acme"))",
        "(allow file-read-metadata (literal "/nope"))",
        "(allow file-read-metadata (literal "/nope/home"))",
        "(allow file-read-metadata (literal "/nope/home/Documents"))",
        "(allow file-read-metadata (literal "/private"))",
        "(allow file-read-metadata (literal "/private/var"))",
        "(deny file-write* (literal "/nope"))",
        "(deny file-write* (literal "/nope/home"))",
        "(deny file-write* file-link (require-all (require-any (regex #"/\\.git/hooks(/|$)") (regex #"/\\.gitconfig(/|$)") (regex #"/\\.config/git/config(/|$)") (regex #"/\\.gitmodules(/|$)") (regex #"/\\.vscode(/|$)") (regex #"/\\.idea(/|$)") (regex #"/\\.envrc(/|$)") (regex #"/\\.mcp\\.json(/|$)") (regex #"/\\.claude/settings\\.json(/|$)") (regex #"/\\.claude/settings\\.local\\.json(/|$)") (regex #"/\\.claude/commands(/|$)") (regex #"/\\.claude/agents(/|$)") (regex #"/\\.codex(/|$)")) ))",
        "(deny file-write-unlink (require-all (regex #"/\\.git$") ))",
        "(deny appleevent-send)",
        "(deny lsopen)",
        "(deny mach-lookup (global-name "com.apple.coreservices.appleevents"))",
        "(deny mach-lookup (global-name "com.apple.dt.CommandLineTools.installondemand"))",
      ]
    `);
  });
});

describe.skipIf(onWindows)(
  "a read-only folder inside a place that opens without asking",
  () => {
    const home = "/nope/home";
    const reach: NativeReach = {
      readOnly: [`${home}/Library/App/uv`],
      readWrite: [`${home}/Library/App/uv/cache`],
      rules: {
        home,
        rules: [{ level: "ask", path: `${home}/Library`, source: "place" }],
        withoutAsking: true,
      },
    };

    it("stays closed to changes under Seatbelt, with its stores open", () => {
      const lines = seatbeltProfile(reach)
        .split("\n")
        .filter((line) => line.includes("Library"));
      expect(lines).toMatchInlineSnapshot(`
      [
        "(allow file-read* file-write* network-outbound (subpath "/nope/home/Library"))",
        "(allow file-read* (subpath "/nope/home/Library/App/uv"))",
        "(deny file-write* (subpath "/nope/home/Library/App/uv"))",
        "(allow file-read* file-write* (subpath "/nope/home/Library/App/uv/cache"))",
        "(allow file-read-metadata (literal "/nope/home/Library"))",
        "(allow file-read-metadata (literal "/nope/home/Library/App"))",
        "(allow file-read-metadata (literal "/nope/home/Library/App/uv"))",
        "(deny file-write* file-link (require-all (require-any (regex #"/\\.git/hooks(/|$)") (regex #"/\\.gitconfig(/|$)") (regex #"/\\.config/git/config(/|$)") (regex #"/\\.gitmodules(/|$)") (regex #"/\\.vscode(/|$)") (regex #"/\\.idea(/|$)") (regex #"/\\.envrc(/|$)") (regex #"/\\.mcp\\.json(/|$)") (regex #"/\\.claude/settings\\.json(/|$)") (regex #"/\\.claude/settings\\.local\\.json(/|$)") (regex #"/\\.claude/commands(/|$)") (regex #"/\\.claude/agents(/|$)") (regex #"/\\.codex(/|$)")) (require-not (subpath "/nope/home/Library/App/uv/cache"))))",
        "(deny file-write-unlink (require-all (regex #"/\\.git$") (require-not (subpath "/nope/home/Library/App/uv/cache"))))",
      ]
    `);
    });

    it("binds the closed-file stand-in's folder read-only under bubblewrap", () => {
      const standIn = runtimeLayout(getWorkspaceConfig().runtimeDir).sandbox;
      const args = bwrapArgs(reach).join(" ");
      expect(args).toContain(`--ro-bind ${realpathSync(standIn)}`);
    });
  },
);

describe.skipIf(onWindows)("the passwords place in a profile", () => {
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

describe.skipIf(onWindows)("refusedPathIn", () => {
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

  it.each([
    "cp: /Users/someone/Documents/Acme Corp/a.csv: Operation not permitted",
    "cat: '/Users/someone/Documents/Acme Corp/a.csv': Operation not permitted",
    "PermissionError: [Errno 1] Operation not permitted: '/Users/someone/Documents/Acme Corp/a.csv'",
    "cp: cannot open ‘/Users/someone/Documents/Acme Corp/a.csv’ for reading: Permission denied",
    "/bin/sh: 1: cannot create /Users/someone/Documents/Acme Corp/a.csv: Permission denied",
  ])("keeps the spaces in the path %s names", (output) => {
    expect(refusedPathIn(output, reach)?.hostPath).toBe(
      "/Users/someone/Documents/Acme Corp/a.csv",
    );
  });

  it.each([
    `cat: "/Users/someone/Documents/Bob's Files/a.txt": Operation not permitted`,
    "cat: /Users/someone/Documents/Bob's Files/a.txt: Operation not permitted",
    `PermissionError: [Errno 1] Operation not permitted: "/Users/someone/Documents/Bob's Files/a.txt"`,
  ])("keeps the apostrophe in the path %s names", (output) => {
    expect(refusedPathIn(output, reach)?.hostPath).toBe(
      "/Users/someone/Documents/Bob's Files/a.txt",
    );
  });

  describe("of the app's own data only", () => {
    const appData = "/Users/someone/Library/Application Support/Instrument";
    const withAppData = reachOver("/Users/someone", [
      ...reach.rules.rules,
      { appData: true, level: "never", path: appData, source: "system" },
    ]);

    it.each([
      [
        "passes over a path a card could open for one in the app's data",
        [
          "cat: /Users/someone/Documents/Acme/a.csv: Operation not permitted",
          `PermissionError: [Errno 1] Operation not permitted: '${appData}/work/other/a.md'`,
        ].join("\n"),
        `${appData}/work/other/a.md`,
      ],
      [
        "finds none where only places are refused",
        "cat: /Users/someone/.ssh/id_ed25519: Operation not permitted",
        undefined,
      ],
    ])("%s", (_name, output, hostPath) => {
      expect(
        refusedPathIn(output, withAppData, undefined, { appDataOnly: true })
          ?.hostPath,
      ).toBe(hostPath);
    });
  });

  it("asks for the folder one level into the place", () => {
    const refused = refusedPathIn(
      "Operation not permitted: '/Users/someone/Documents/Acme/a.csv'",
      reach,
    );
    expect(refused && refusalNote(refused)).toMatchInlineSnapshot(
      `""~/Documents/Acme/a.csv" needs the person's yes first."`,
    );
  });

  it.each([
    [
      "mkdir: cannot create directory '/Users/someone/newproj': Read-only file system",
      "~/newproj",
    ],
    [
      "fatal: cannot mkdir /Users/someone/newproj: Read-only file system",
      "~/newproj",
    ],
    [
      "mkdir: cannot create directory ‘/Users/someone/newproj’: Read-only file system",
      "~/newproj",
    ],
    [
      "touch: cannot touch '/Users/someone/newproj/x': Read-only file system",
      "~/newproj",
    ],
    [
      "touch: cannot touch '/Users/someone/notes.txt': Read-only file system",
      undefined,
    ],
  ])("%s asks for %s", (output, asked) => {
    vi.mocked(raiseAsk).mockClear();
    const refused = refusedPathIn(output, {
      ...reach,
      rules: {
        ...reach.rules,
        asker: {
          chatId: ChatIdSchema.parse("native-sandbox-test"),
          sessionId: StoreId.newSessionId(),
        },
      },
    });
    const note = refused && refusalNote(refused);
    expect(vi.mocked(raiseAsk).mock.calls[0]?.[2]).toBe(
      asked?.replace("~", "/Users/someone"),
    );
    expect(note).toBe(
      asked
        ? `Waiting on the person to allow "${asked}". If the rest of the job needs it, end your turn here; you'll be woken with their answer. Run the command again once they allow it.`
        : `"~/notes.txt" is directly in "~", which no card can open whole. Work in this conversation's folder, or a folder the person names.`,
    );
  });

  it("asks nothing for a change only an administrator could make", () => {
    vi.mocked(accountCanWrite).mockReturnValueOnce(false);
    const refused = refusedPathIn(
      "Operation not permitted: '/Users/someone/Documents/Acme/a.csv'",
      reach,
    );
    expect(refused && refusalNote(refused)).toMatchInlineSnapshot(
      `""~/Documents/Acme/a.csv" belongs to the system, and only an administrator can change it. Write what you need somewhere you can, or tell the person what you needed it for."`,
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
  // A file the person sent from the closed folder, open alone.
  const sent = path.join(closed, "sent.md");
  writeFileSync(sent, "d");
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
    { file: true, level: "allow", path: sent, source: "grant" },
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
    ["reads a file sent from a closed folder", ["cat", sent], 0],
    [
      "changes a file sent from a closed folder in place",
      ["sh", "-c", `echo x > ${sent}`],
      0,
    ],
    [
      "refuses a new file beside one sent from a closed folder",
      ["sh", "-c", `echo x > ${path.join(closed, "new")}`],
      1,
    ],
    [
      "refuses a closed folder by its Data-volume path",
      ["cat", `/System/Volumes/Data${path.join(closed, "key")}`],
      1,
    ],
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

  it("closes a socket in a closed place, and leaves one in a place that asks", async () => {
    const listen = (socket: string) =>
      new Promise<net.Server>((resolve) => {
        const server = net.createServer((client) => client.end());
        server.listen(socket, () => resolve(server));
      });
    const inClosed = path.join(closed, "agent.sock");
    const inAsks = path.join(asks, "runtime.sock");
    const servers = await Promise.all([listen(inClosed), listen(inAsks)]);
    const connect = (socket: string) =>
      run("/usr/bin/python3", [
        "-c",
        `import socket; s = socket.socket(socket.AF_UNIX); s.connect(${JSON.stringify(socket)})`,
      ]);
    try {
      expect((await connect(inClosed)).exitCode).not.toBe(0);
      expect((await connect(inAsks)).exitCode).toBe(0);
    } finally {
      for (const server of servers) {
        server.close();
      }
    }
  });

  it("keeps a sign-in folder closed when using folders without asking opens the other hidden ones", async () => {
    mkdirSync(path.join(home, ".ssh"), { recursive: true });
    writeFileSync(path.join(home, ".ssh", "id"), "k");
    const withoutAsking = {
      ...reach,
      rules: {
        ...reach.rules,
        // The passwords place comes before other apps' files, as in
        // `placeRules`.
        rules: [
          {
            level: "ask",
            path: path.join(home, ".ssh"),
            place: "passwords",
            source: "place",
          } satisfies Rule,
          ...reach.rules.rules,
        ],
        withoutAsking: true,
      },
    };
    const cat = (file: string) => {
      const spawned = wrapNativeCommand("/bin/cat", [file], withoutAsking);
      return execa(spawned.file, spawned.args, { reject: false });
    };
    expect((await cat(path.join(home, ".hidden", "x"))).exitCode).toBe(0);
    expect((await cat(path.join(home, ".ssh", "id"))).exitCode).not.toBe(0);
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

  it("refuses a hard link to a name that runs code", async () => {
    mkdirSync(path.join(granted, ".claude"), { recursive: true });
    writeFileSync(path.join(granted, ".claude", "settings.json"), "{}");
    const result = await run("/bin/ln", [
      path.join(granted, ".claude", "settings.json"),
      path.join(granted, "h"),
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(existsSync(path.join(granted, "h"))).toBe(false);
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
  // A file the person sent from the closed folder, open alone.
  const sent = path.join(closed, "sent.md");
  writeFileSync(sent, "d");
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
    { file: true, level: "allow", path: sent, source: "grant" },
  ]);

  it.each([
    ["reads a file nothing holds", `cat ${path.join(home, "notes.md")}`, 0],
    ["reads in a granted folder", `cat ${path.join(granted, "brief.md")}`, 0],
    ["writes in a granted folder", `echo x > ${path.join(granted, "new")}`, 0],
    ["refuses a closed folder", `cat ${path.join(closed, "key")}`, 1],
    ["reads a file sent from a closed folder", `cat ${sent}`, 0],
    [
      "changes a file sent from a closed folder in place",
      `echo x > ${sent}`,
      0,
    ],
    [
      "refuses a new file beside one sent from a closed folder",
      `echo x > ${path.join(closed, "new")}`,
      1,
    ],
    ["refuses a place that asks", `cat ${path.join(asks, "other.txt")}`, 1],
    ["refuses a hidden folder", `cat ${path.join(home, ".hidden", "x")}`, 1],
    [
      "refuses a change nothing allows",
      `echo x > ${path.join(home, "new")}`,
      1,
    ],
    ["refuses opening up a place that asks", `chmod 755 ${asks}`, 1],
    [
      "refuses writing in a place that asks once its mode is changed",
      `chmod 755 ${asks}; echo x > ${path.join(asks, "y")}`,
      1,
    ],
  ])("%s", async (_name, script, exitCode) => {
    const spawned = wrapNativeCommand("/bin/sh", ["-c", script], reach);
    const result = await execa(spawned.file, spawned.args, { reject: false });
    expect(result.exitCode === 0 ? 0 : 1).toBe(exitCode);
  });
});

describe.skipIf(onWindows)("bwrapArgs", () => {
  // The appFiles place is a rule over the hidden entries of the home folder,
  // so the folder it names is home itself. The walk for names that run code
  // has to stop at the entries such a rule closes, not at home.
  it("leaves a hidden home folder the rules hold at ask closed to a program", () => {
    const home = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "bwrap-dot-")),
    );
    mkdirSync(path.join(home, ".config/nvim/.git"), { recursive: true });
    const rules: Rule[] = [
      { level: "allow", path: home, source: "grant" },
      { dotEntries: true, level: "ask", path: home, source: "place" },
    ];

    const args = bwrapArgs(reachOver(home, rules)).join(" ");

    expect(
      reachOf(
        { home, rules, withoutAsking: false },
        path.join(home, ".config"),
        "write",
      ).level,
    ).toBe("ask");
    for (const closed of [".config", ".config/nvim", ".config/nvim/.git"]) {
      expect(args).not.toContain(
        `--bind ${path.join(home, closed)} ${path.join(home, closed)}`,
      );
    }
    rmSync(home, { force: true, recursive: true });
  });

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
    expect(args).toContain(
      `--perms 0000 --tmpfs ${home}/Secrets --remount-ro ${home}/Secrets`,
    );
    // Read-only only once the folder opened inside it is bound in.
    expect(args.lastIndexOf(`--remount-ro ${home}/Documents`)).toBeGreaterThan(
      args.indexOf(`--bind ${home}/Documents/Acme`),
    );
    expect(args.endsWith(`--remount-ro ${home}/Documents`)).toBe(true);
    expect(args).toMatch(
      new RegExp(`--ro-bind \\S*/closed-file ${home}/secret.txt`),
    );
    rmSync(home, { force: true, recursive: true });
  });

  it("never changes a file a link in place of the closed file leads to", () => {
    const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "bwrap-")));
    const victim = path.join(home, "thesis.docx");
    writeFileSync(victim, "x", { mode: 0o644 });
    writeFileSync(path.join(home, "secret.txt"), "x");
    // Where a sandboxed command could plant one: the system's temp folder,
    // and the app's own folder, which it may not.
    const planted = [
      path.join(os.tmpdir(), `instrument-closed-${process.getuid?.() ?? 0}`),
      path.join(
        runtimeLayout(getWorkspaceConfig().runtimeDir).sandbox,
        "closed-file",
      ),
    ];
    for (const link of planted) {
      mkdirSync(path.dirname(link), { recursive: true });
      rmSync(link, { force: true });
      symlinkSync(victim, link);
    }
    const args = bwrapArgs(
      reachOver(home, [
        {
          level: "never",
          path: path.join(home, "secret.txt"),
          source: "place",
        },
      ]),
    );
    const bound = args[args.indexOf(path.join(home, "secret.txt")) - 1] ?? "";
    expect(statSync(victim).mode & 0o777).toBe(0o644);
    expect(lstatSync(bound).isSymbolicLink()).toBe(false);
    expect(statSync(bound).mode & 0o777).toBe(0);
    for (const link of planted) {
      rmSync(link, { force: true });
    }
    rmSync(home, { force: true, recursive: true });
  });

  it("binds a file the person sent alone, never makes one that is gone, and binds one that runs code read-only", () => {
    const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "bwrap-")));
    const closed = path.join(home, "Private");
    mkdirSync(closed);
    const sent = path.join(closed, "report.md");
    const envrc = path.join(closed, ".envrc");
    const gone = path.join(closed, "deleted.md");
    writeFileSync(sent, "r");
    writeFileSync(envrc, "e");
    const args = bwrapArgs(
      reachOver(home, [
        { level: "never", path: closed, source: "folder" },
        ...[sent, envrc, gone].map(
          (file): Rule => ({
            file: true,
            level: "allow",
            path: file,
            source: "grant",
          }),
        ),
      ]),
    ).join(" ");
    expect(args).toContain(`--bind ${sent} ${sent}`);
    expect(args).toContain(`--ro-bind ${envrc} ${envrc}`);
    expect(args).not.toContain(gone);
    expect(existsSync(gone)).toBe(false);
    rmSync(home, { force: true, recursive: true });
  });

  it("leaves the temp folder to the rule that opens it", () => {
    // The layout holds each temp folder with a system allow rule, which
    // binds it; a fixed bind besides would mount it twice.
    expect(bwrapArgs(reachOver("/nope/home", [])).join(" ")).not.toContain(
      "--bind /tmp /tmp",
    );
  });
});

describe.skipIf(onWindows)("bwrapArgs over the login session's sockets", () => {
  const scratch = realpathSync(mkdtempSync(path.join(os.tmpdir(), "bwrap-")));
  afterAll(() => {
    rmSync(scratch, { force: true, recursive: true });
  });
  const home = path.join(scratch, "home");
  const runtimeDir = path.join(scratch, "run-user");
  mkdirSync(path.join(home, ".ssh"), { recursive: true });
  mkdirSync(path.join(runtimeDir, "gnupg"), { recursive: true });
  for (const socket of ["bus", "ssh-agent", "gnupg/S.gpg-agent"]) {
    writeFileSync(path.join(runtimeDir, socket), "");
  }
  mkdirSync(path.join(scratch, "tmp-ssh"));
  writeFileSync(path.join(scratch, "tmp-ssh", "agent.1"), "");
  const sshRule = (level: "allow" | "ask"): Rule => ({
    level,
    path: path.join(home, ".ssh"),
    place: "passwords",
    source: "place",
  });
  const sessionArgs = (level: "allow" | "ask", agentSocket: string) =>
    bwrapArgs(reachOver(home, [sshRule(level)]), undefined, {
      agentSocket,
      runtimeDir,
    })
      .join(" ")
      .replaceAll(scratch, "<s>")
      .replace(/--ro-bind \S*\/closed-file/, "--ro-bind <closed-file>")
      .split(/ (?=--)/)
      .filter((arg) => arg.includes("<s>/run-user") || arg.includes("tmp-ssh"));

  it("empties the runtime folder, and keeps the ssh-agent in it closed while ~/.ssh asks", () => {
    expect(sessionArgs("ask", path.join(runtimeDir, "ssh-agent")))
      .toMatchInlineSnapshot(`
      [
        "--tmpfs <s>/run-user",
      ]
    `);
  });

  it("binds the ssh-agent back once ~/.ssh is allowed", () => {
    expect(sessionArgs("allow", path.join(runtimeDir, "ssh-agent")))
      .toMatchInlineSnapshot(`
      [
        "--tmpfs <s>/run-user",
        "--bind <s>/run-user/ssh-agent <s>/run-user/ssh-agent",
      ]
    `);
  });

  it("covers an ssh-agent outside the runtime folder while ~/.ssh asks", () => {
    expect(sessionArgs("ask", path.join(scratch, "tmp-ssh", "agent.1")))
      .toMatchInlineSnapshot(`
      [
        "--tmpfs <s>/run-user",
        "--ro-bind <closed-file> <s>/tmp-ssh/agent.1",
      ]
    `);
  });
});

describe.skipIf(onWindows)("bwrapArgs over names that run code", () => {
  /** A home with `paths` made in it: a trailing slash makes a folder. */
  function plant(paths: string[]): string {
    const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "bwrap-")));
    for (const each of paths) {
      const target = path.join(home, each);
      if (each.endsWith("/")) {
        mkdirSync(target, { recursive: true });
      } else {
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, "");
      }
    }
    return home;
  }

  /** The binds after the fixed ones, spelled from the home. */
  function binds(
    home: string,
    rules: Rule[],
    {
      readWrite = [],
      walk,
    }: {
      readWrite?: string[];
      walk?: { depth: number; entries: number };
    } = {},
  ): string[] {
    const args = bwrapArgs(
      { readOnly: [], readWrite, rules: { home, rules, withoutAsking: false } },
      walk,
    );
    const lines: string[] = [];
    const after = args.slice(args.indexOf("--new-session") + 1);
    for (const [index, arg] of after.entries()) {
      const spelled = arg.startsWith(home) ? `~${arg.slice(home.length)}` : arg;
      const last = lines.at(-1) ?? "";
      // One mount a line: `--perms` goes with its `--tmpfs`, and so does a
      // `--remount-ro` right after it.
      const joins =
        !arg.startsWith("--") ||
        (arg === "--remount-ro" &&
          last.endsWith(` ${(after[index + 1] ?? "").replace(home, "~")}`)) ||
        (arg === "--tmpfs" && last.split(" ").length === 2);
      if (joins && lines.length > 0) {
        lines[lines.length - 1] = `${last} ${spelled}`;
      } else {
        lines.push(spelled);
      }
    }
    rmSync(home, { force: true, recursive: true });
    return lines.filter((line) => line.includes("~/"));
  }

  const documents = (home: string): Rule[] => [
    { level: "ask", path: path.join(home, "Documents"), source: "place" },
    { level: "allow", path: path.join(home, "Documents"), source: "grant" },
  ];

  it("keeps a repository two folders down in place, with its hooks read-only", () => {
    const home = plant([
      "Documents/code/app/.git/hooks/",
      "Documents/code/app/.git/HEAD",
      "Documents/code/app/src/main.py",
    ]);
    expect(binds(home, documents(home))).toMatchInlineSnapshot(`
      [
        "--bind ~/Documents ~/Documents",
        "--bind ~/Documents/code ~/Documents/code",
        "--bind ~/Documents/code/app ~/Documents/code/app",
        "--bind ~/Documents/code/app/.git ~/Documents/code/app/.git",
        "--ro-bind ~/Documents/code/app/.git/hooks ~/Documents/code/app/.git/hooks",
      ]
    `);
  });

  it("binds names that run code read-only, at the top and deeper", () => {
    const home = plant([
      "Documents/.mcp.json",
      "Documents/site/.envrc",
      "Documents/site/.claude/settings.json",
      "Documents/site/.claude/notes.md",
      "Documents/site/.vscode/tasks.json",
    ]);
    expect(binds(home, documents(home))).toMatchInlineSnapshot(`
      [
        "--bind ~/Documents ~/Documents",
        "--ro-bind ~/Documents/.mcp.json ~/Documents/.mcp.json",
        "--bind ~/Documents/site ~/Documents/site",
        "--bind ~/Documents/site/.claude ~/Documents/site/.claude",
        "--ro-bind ~/Documents/site/.envrc ~/Documents/site/.envrc",
        "--ro-bind ~/Documents/site/.vscode ~/Documents/site/.vscode",
        "--ro-bind ~/Documents/site/.claude/settings.json ~/Documents/site/.claude/settings.json",
      ]
    `);
  });

  it("gives a repository with no hooks folder an empty one nothing can write", () => {
    const home = plant(["Documents/app/.git/HEAD"]);
    expect(binds(home, documents(home))).toMatchInlineSnapshot(`
      [
        "--bind ~/Documents ~/Documents",
        "--bind ~/Documents/app ~/Documents/app",
        "--bind ~/Documents/app/.git ~/Documents/app/.git",
        "--tmpfs ~/Documents/app/.git/hooks --remount-ro ~/Documents/app/.git/hooks",
      ]
    `);
  });

  it("leaves the chat's own folder and a folder another rule decides alone", () => {
    const home = plant([
      "Documents/chat/.git/hooks/",
      "Documents/chat/.envrc",
      "Documents/Payroll/.git/hooks/",
      "Chat/.git/hooks/",
    ]);
    expect(
      binds(
        home,
        [
          ...documents(home),
          {
            level: "never",
            path: path.join(home, "Documents/Payroll"),
            source: "folder",
          },
          { level: "allow", path: path.join(home, "Chat"), source: "grant" },
        ],
        {
          readWrite: [
            path.join(home, "Documents/chat"),
            path.join(home, "Chat"),
          ],
        },
      ).filter((line) => !line.includes("Payroll ")),
    ).toMatchInlineSnapshot(`
      [
        "--bind ~/Documents ~/Documents",
        "--bind ~/Chat ~/Chat",
        "--bind ~/Documents/chat ~/Documents/chat",
      ]
    `);
  });

  it.each([
    ["depth", { depth: 2, entries: 1000 }],
    ["entry count", { depth: 3, entries: 3 }],
  ])("stops at its %s cap, deepest first", (_cap, walk) => {
    const home = plant([
      "Documents/a/.git/HEAD",
      "Documents/a/b/x/",
      "Documents/a/b/.git/HEAD",
    ]);
    expect(
      binds(home, documents(home), { walk }).filter((line) =>
        line.includes(".git "),
      ),
    ).toEqual(["--bind ~/Documents/a/.git ~/Documents/a/.git"]);
  });
});
