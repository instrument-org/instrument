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
  bwrapArgs,
  bwrapAvailable,
  launchNative,
  seatbeltAvailable,
  seatbeltProfile,
  wrapNativeCommand,
  type WrappedCommand,
} from "./index";
import { inheritedEnv } from "../native-env";
import { REACHABLE_APPS } from "../permissions/apps";
import { reachOf, type Rule } from "../permissions/rules";
import { AbsolutePathSchema } from "../../schemas/paths";
import { runtimeLayout } from "../runtime-dir";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";

// The rules below hold a made-up home, which nothing on this disk lets the
// account change; whether it could is the system's answer, set per test.
vi.mock("../permissions/account-can-write", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../permissions/account-can-write")
  >()),
  accountCanWrite: vi.fn(() => true),
}));

// Windows runs native commands with no Seatbelt or bubblewrap profile, so
// nothing there builds one or reads the refusals of a command held by one.
const onWindows = process.platform === "win32";

/** The arguments a wrapped command spawns with, as every caller launches it. */
function argsOf(spawned: WrappedCommand): string[] {
  return launchNative(spawned, { env: {} }).args;
}

function reachOver(home: string, rules: Rule[]): NativeReach {
  return {
    readOnly: [],
    readWrite: [],
    rules: { home, rules, dangerouslyAllowEveryFolder: false },
  };
}

describe.skipIf(onWindows)("seatbeltProfile", () => {
  // The profile opens the way to this computer's own temp folder for
  // metadata, which is `/private/var/folders/...` on a Mac and `/tmp`
  // elsewhere, so the lines around the filtered ones are the Mac's. Seatbelt
  // holds a program on a Mac alone, so that is the profile worth pinning.
  it.runIf(process.platform === "darwin")(
    "closes the disk and home to changes, then applies rules shallow to deep",
    () => {
      const profile = seatbeltProfile(
        reachOver("/nope/home", [
          {
            level: "allow",
            path: "/nope/home/Documents/Acme",
            source: "grant",
          },
          { level: "ask", path: "/nope/home/Documents", source: "place" },
          {
            dotEntries: true,
            level: "ask",
            path: "/nope/home",
            source: "place",
          },
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
        "(deny appleevent-send)",
        "(deny lsopen)",
        "(deny mach-lookup (global-name "com.apple.coreservices.appleevents"))",
        "(deny mach-lookup (global-name "com.apple.dt.CommandLineTools.installondemand"))",
        "(deny job-creation)",
        "(deny mach-lookup (global-name "com.apple.siri.VoiceShortcuts.xpc") (global-name "com.apple.siriactionsd.xpc") (global-name "com.apple.shortcuts.systemshortcutservice.runner") (xpc-service-name "com.apple.WorkflowKit.BackgroundShortcutRunner"))",
        "(deny signal)",
        "(allow signal (target same-sandbox))",
      ]
    `);
    },
  );
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
        dangerouslyAllowEveryFolder: true,
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

/**
 * A listed place, as App files is on a Mac while it asks first, with what
 * stays closed in it, an app's folder opened, and its caches open.
 */
function listedLibrary(home: string): Rule[] {
  const library = path.join(home, "Library");
  return [
    {
      level: "ask",
      listed: true,
      path: library,
      place: "appFiles",
      source: "place",
    },
    {
      level: "never",
      path: path.join(library, "Keychains"),
      place: "passwords",
      source: "place",
    },
    {
      appData: true,
      level: "never",
      path: path.join(library, "Application Support", "Instrument"),
      source: "system",
    },
    {
      level: "readOnly",
      path: path.join(library, "Application Support", "Instrument", "skills"),
      source: "system",
    },
    {
      level: "allow",
      path: path.join(library, "Application Support", "Code"),
      source: "grant",
    },
    {
      level: "allow",
      path: path.join(library, "Caches"),
      place: "appFiles",
      source: "place",
    },
  ];
}

describe.skipIf(onWindows)("a listed place in a profile", () => {
  const home = "/nope/home";
  const lines = (rules: Rule[], dangerouslyAllowEveryFolder = false) =>
    seatbeltProfile({
      ...reachOver(home, rules),
      rules: { dangerouslyAllowEveryFolder, home, rules },
    })
      .split("\n")
      .filter(
        (line) =>
          line.includes("/nope/home/Library") && !line.includes("literal"),
      );

  // Seatbelt ranks a rule naming one operation over `file-read*` whatever
  // the order, so every rule inside the listed folder names the two the
  // listing does as well.
  it("lists folders and metadata, and says the same of every rule inside", () => {
    expect(lines(listedLibrary(home))).toMatchInlineSnapshot(`
      [
        "(deny file-read* file-write* (subpath "/nope/home/Library"))",
        "(allow file-read-data (require-all (subpath "/nope/home/Library") (vnode-type DIRECTORY)))",
        "(allow file-read-metadata (subpath "/nope/home/Library"))",
        "(deny file-read* file-write* network-outbound (subpath "/nope/home/Library/Keychains"))",
        "(deny file-read-data file-read-metadata (subpath "/nope/home/Library/Keychains"))",
        "(allow file-read* file-write* network-outbound (subpath "/nope/home/Library/Caches"))",
        "(allow file-read-data file-read-metadata (subpath "/nope/home/Library/Caches"))",
        "(allow file-read* file-write* network-outbound (subpath "/nope/home/Library/Application Support/Code"))",
        "(allow file-read-data file-read-metadata (subpath "/nope/home/Library/Application Support/Code"))",
        "(deny file-read* file-write* network-outbound (subpath "/nope/home/Library/Application Support/Instrument"))",
        "(deny file-read-data file-read-metadata (subpath "/nope/home/Library/Application Support/Instrument"))",
        "(allow file-read* (subpath "/nope/home/Library/Application Support/Instrument/skills"))",
        "(allow file-read-data file-read-metadata (subpath "/nope/home/Library/Application Support/Instrument/skills"))",
        "(deny file-write* (subpath "/nope/home/Library/Application Support/Instrument/skills"))",
      ]
    `);
  });

  it("lists nothing on its own once using folders without asking opens the place", () => {
    expect(
      lines(listedLibrary(home), true).filter((line) =>
        line.includes("file-read-data"),
      ),
    ).toMatchInlineSnapshot(`[]`);
  });
});

describe.skipIf(onWindows)("Shortcuts in a profile", () => {
  const lines = (shortcutsAllowed?: boolean) =>
    seatbeltProfile({
      ...reachOver("/nope/home", []),
      closedServices:
        shortcutsAllowed === undefined
          ? undefined
          : REACHABLE_APPS.filter(
              ({ app }) => app.name !== "Shortcuts" || !shortcutsAllowed,
            ).flatMap(({ services }) => services),
    })
      .split("\n")
      .filter((line) => line.includes("Shortcut"));

  it("closes the services a shortcut runs in until Shortcuts is allowed", () => {
    expect(lines()).toMatchInlineSnapshot(`
      [
        "(deny mach-lookup (global-name "com.apple.siri.VoiceShortcuts.xpc") (global-name "com.apple.siriactionsd.xpc") (global-name "com.apple.shortcuts.systemshortcutservice.runner") (xpc-service-name "com.apple.WorkflowKit.BackgroundShortcutRunner"))",
      ]
    `);
    expect(lines(false)).toEqual(lines());
    expect(lines(true)).toEqual([]);
  });
});

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

  const asks = reachOver(home, [signIns]);
  const granted = reachOver(home, [
    signIns,
    { level: "allow", path: `${home}/.ssh`, source: "grant" },
  ]);

  it.each([
    ["no command", undefined, false],
    ["a command held to rules where .ssh asks", { reach: asks }, false],
    ["a command held to rules with .ssh granted", { reach: granted }, true],
    // A program that is not there comes back unwrapped on every platform,
    // as every command does where no sandbox can hold it (Windows without
    // MXC), and is decided by the same rules.
    [
      "an unwrapped command whose rules ask for .ssh",
      wrapNativeCommand("/nope/missing", [], asks),
      false,
    ],
    [
      "an unwrapped command whose rules grant .ssh",
      wrapNativeCommand("/nope/missing", [], granted),
      true,
    ],
    [
      "an app the person allowed, run with no rules",
      wrapNativeCommand("/nope/missing", [], null),
      false,
    ],
  ])("keeps the ssh-agent's socket for %s: %s", (_name, spawned, kept) => {
    expect(inheritedEnv(env, spawned)).toEqual({
      PATH: "/usr/bin",
      ...(kept && { SSH_AUTH_SOCK: "/tmp/agent" }),
    });
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
    return execa(spawned.file, argsOf(spawned), { reject: false });
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
    const dangerouslyAllowEveryFolder = {
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
        dangerouslyAllowEveryFolder: true,
      },
    };
    const cat = (file: string) => {
      const spawned = wrapNativeCommand(
        "/bin/cat",
        [file],
        dangerouslyAllowEveryFolder,
      );
      return execa(spawned.file, argsOf(spawned), { reject: false });
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
      return execa(spawned.file, argsOf(spawned), { reject: false });
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
    const result = await execa(spawned.file, argsOf(spawned), {
      reject: false,
    });
    expect(result.exitCode).not.toBe(0);
    expect(existsSync(path.join(granted, "Moved"))).toBe(false);
  });

  it("signals its own children, and nothing it did not start", async () => {
    const outside = execa("/bin/sleep", ["98711"], { reject: false });
    try {
      const pid = String(outside.pid);
      for (const [file, args] of [
        ["/bin/kill", [pid]],
        ["/usr/bin/pkill", ["-f", "sleep 98711"]],
      ] as const) {
        const result = await run(file, [...args]);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("Operation not permitted");
      }
      const own = await run("/bin/sh", [
        "-c",
        "sleep 98712 & kill $!; wait $!; echo $?",
      ]);
      expect(own.stdout.trim()).toBe("143");
      expect(outside.exitCode).toBeNull();
    } finally {
      outside.kill();
      await outside;
    }
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

describe.runIf(seatbeltAvailable())("a listed place on this Mac", () => {
  const home = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "native-sandbox-listed-")),
  );
  const at = (relative: string) => path.join(home, "Library", relative);
  for (const [file, text] of [
    ["Preferences/app.plist", "p"],
    ["Keychains/login.keychain-db", "k"],
    ["Application Support/Instrument/keys/key", "s"],
    ["Application Support/Instrument/skills/a/SKILL.md", "a"],
    ["Application Support/Code/User/settings.json", "c"],
    ["Caches/tool/cache.bin", "t"],
  ] as const) {
    mkdirSync(path.dirname(at(file)), { recursive: true });
    writeFileSync(at(file), text);
  }
  const reach = reachOver(home, listedLibrary(home));

  afterAll(() => {
    rmSync(home, { force: true, recursive: true });
  });

  async function sh(script: string) {
    const spawned = wrapNativeCommand("/bin/sh", ["-c", script], reach);
    const result = await execa(spawned.file, argsOf(spawned), {
      reject: false,
    });
    return result.exitCode === 0 ? result.stdout.trim() : "refused";
  }

  it.each([
    [
      "lists the place",
      `ls '${at("")}'`,
      "Application Support\nCaches\nKeychains\nPreferences",
    ],
    ["lists a folder in it", `ls '${at("Preferences")}'`, "app.plist"],
    ["gives a file's size", `stat -f %z '${at("Preferences/app.plist")}'`, "1"],
    ["opens no file in it", `cat '${at("Preferences/app.plist")}'`, "refused"],
    ["changes nothing in it", `touch '${at("Preferences/new")}'`, "refused"],
    ["keeps a sign-in folder unlisted", `ls '${at("Keychains")}'`, "refused"],
    [
      "keeps the app's own data unlisted",
      `ls '${at("Application Support/Instrument")}'`,
      "refused",
    ],
    [
      "reads the app's own folder opened in it",
      `cat '${at("Application Support/Instrument/skills/a/SKILL.md")}'`,
      "a",
    ],
    [
      "reads an app's folder the person allowed",
      `cat '${at("Application Support/Code/User/settings.json")}'`,
      "c",
    ],
    [
      "changes an app's folder the person allowed",
      `touch '${at("Application Support/Code/new")}' && echo made`,
      "made",
    ],
    ["reads the caches", `cat '${at("Caches/tool/cache.bin")}'`, "t"],
  ])("%s", async (_name, script, expected) => {
    expect(await sh(script)).toBe(expected);
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
    const result = await execa(spawned.file, argsOf(spawned), {
      reject: false,
    });
    expect(result.exitCode === 0 ? 0 : 1).toBe(exitCode);
  });
});

describe.skipIf(onWindows)("bwrapArgs", () => {
  // The appFiles place is a rule over the hidden entries of the home folder,
  // so the folder it names is home itself, and an allow on home leaves them
  // to it.
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
        { home, rules, dangerouslyAllowEveryFolder: false },
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

  it("makes a folder the app keeps read-only inside a writable one before binding it", () => {
    const home = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "bwrap-drafts-")),
    );
    const workspace = path.join(home, "Instrument");
    const drafts = path.join(workspace, "Drafts");
    mkdirSync(workspace);
    const args = bwrapArgs(
      reachOver(home, [
        { level: "allow", path: workspace, source: "grant" },
        { level: "readOnly", path: drafts, source: "system" },
      ]),
    ).join(" ");
    expect(existsSync(drafts)).toBe(true);
    expect(args).toContain(`--ro-bind ${drafts} ${drafts}`);
    rmSync(home, { force: true, recursive: true });
  });

  it("binds the caches open, with a browser's and the updater's closed in them", () => {
    const home = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "bwrap-cache-")),
    );
    const at = (relative: string) => path.join(home, relative);
    for (const folder of [
      ".config/app",
      ".cache/pip",
      ".cache/google-chrome",
      ".cache/instrument-desktop-updater",
    ]) {
      mkdirSync(at(folder), { recursive: true });
    }
    const args = bwrapArgs(
      reachOver(home, [
        {
          level: "ask",
          path: at(".config"),
          place: "appFiles",
          source: "place",
        },
        {
          level: "allow",
          path: at(".cache"),
          place: "appFiles",
          source: "place",
        },
        {
          level: "never",
          path: at(".cache/google-chrome"),
          place: "passwords",
          source: "place",
        },
        {
          appData: true,
          level: "never",
          path: at(".cache/instrument-desktop-updater"),
          source: "system",
        },
      ]),
    )
      .join(" ")
      .replaceAll(home, "~");
    expect(args).toContain("--tmpfs ~/.config ");
    expect(args).toContain("--bind ~/.cache ~/.cache");
    expect(args).toContain("--tmpfs ~/.cache/google-chrome ");
    expect(args).toContain("--tmpfs ~/.cache/instrument-desktop-updater ");
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

  it("makes a closed folder read-only only after a folder a link opens inside it", () => {
    const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "bwrap-")));
    const work = path.join(home, "Documents/work");
    mkdirSync(work, { recursive: true });
    symlinkSync(work, path.join(home, "work"));
    const args = bwrapArgs(
      reachOver(home, [
        { level: "ask", path: path.join(home, "Documents"), source: "place" },
        { level: "allow", path: path.join(home, "work"), source: "grant" },
      ]),
    ).join(" ");
    expect(args).toContain(`--perms 0111 --tmpfs ${home}/Documents`);
    expect(args.lastIndexOf(`--remount-ro ${home}/Documents`)).toBeGreaterThan(
      args.indexOf(`--bind ${work} ${work}`),
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

  it("binds a file the person sent alone, and never makes one that is gone", () => {
    const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "bwrap-")));
    const closed = path.join(home, "Private");
    mkdirSync(closed);
    const sent = path.join(closed, "report.md");
    const gone = path.join(closed, "deleted.md");
    writeFileSync(sent, "r");
    const args = bwrapArgs(
      reachOver(home, [
        { level: "never", path: closed, source: "folder" },
        ...[sent, gone].map(
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
    bwrapArgs(reachOver(home, [sshRule(level)]), {
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

/** What `pnpm --filter @instrument-org/studio build:mac-helper` builds. */
const SEATBELT_LAUNCHER = path.resolve(
  import.meta.dirname,
  "../../../../../apps/studio/native/mac-helper/.build/bridge/instrument-seatbelt",
);

describe.runIf(seatbeltAvailable())("the Seatbelt launcher", () => {
  const home = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "native-sandbox-launcher-")),
  );
  const closed = path.join(home, "closed");
  mkdirSync(closed);
  writeFileSync(path.join(closed, "key"), "s");
  writeFileSync(path.join(home, "notes.md"), "n");
  const reach = reachOver(home, [
    { level: "never", path: closed, source: "place" },
  ]);

  function withLauncher(launcher: string | undefined) {
    const { seatbeltHelperPath: _, ...config } = getWorkspaceConfig();
    setWorkspaceConfig(
      launcher === undefined
        ? config
        : { ...config, seatbeltHelperPath: AbsolutePathSchema.parse(launcher) },
    );
  }

  afterAll(() => {
    withLauncher(undefined);
    rmSync(home, { force: true, recursive: true });
  });

  it.runIf(existsSync(SEATBELT_LAUNCHER))(
    "starts a command through the launcher and holds it to the same rules",
    async () => {
      withLauncher(SEATBELT_LAUNCHER);
      const allowed = wrapNativeCommand(
        "/bin/cat",
        [path.join(home, "notes.md")],
        reach,
      );
      expect(allowed.file).toBe(SEATBELT_LAUNCHER);
      expect(argsOf(allowed)[0]).toBe("run");
      const read = await execa(allowed.file, argsOf(allowed), {
        reject: false,
      });
      expect(read).toMatchObject({ exitCode: 0, stdout: "n" });

      const refused = wrapNativeCommand(
        "/bin/cat",
        [path.join(closed, "key")],
        reach,
      );
      const result = await execa(refused.file, argsOf(refused), {
        reject: false,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Operation not permitted");
    },
  );

  it.runIf(existsSync(SEATBELT_LAUNCHER))(
    "runs nothing when the bytecode cannot be applied",
    async () => {
      const result = await execa(
        SEATBELT_LAUNCHER,
        [
          "run",
          Buffer.from("not bytecode").toString("base64"),
          "/bin/echo",
          "ran",
        ],
        { reject: false },
      );
      expect(result.exitCode).toBe(126);
      expect(result.stdout).toBe("");
    },
  );

  it.each([
    ["is missing", path.join(home, "no-launcher")],
    ["cannot compile the profile", "/usr/bin/false"],
  ])("falls back to sandbox-exec when the launcher %s", (_, launcher) => {
    withLauncher(launcher);
    // A reach of its own, whose profile no earlier case compiled.
    const own = reachOver(path.join(home, launcher.length.toString()), []);
    const spawned = wrapNativeCommand("/bin/cat", ["x"], own);
    expect(spawned.file).toBe("/usr/bin/sandbox-exec");
    expect(argsOf(spawned)[0]).toBe("-p");
  });
});
