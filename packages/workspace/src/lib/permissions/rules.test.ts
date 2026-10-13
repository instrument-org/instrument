import { describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { folderToAskFor, reachOf, rulesFor } from "./rules";

const home = "/Users/someone";
const settings = { apps: [], folders: [], places: {}, withoutAsking: false };

describe.runIf(process.platform === "darwin")("reachOf on a Mac", () => {
  const rules = rulesFor({
    grants: [
      {
        grantedAt: new Date(0),
        path: AbsolutePathSchema.parse(`${home}/Documents/Clients/Acme`),
        source: "card",
      },
    ],
    home,
    settings: {
      ...settings,
      folders: [
        {
          addedAt: new Date(0),
          level: "never",
          path: AbsolutePathSchema.parse(
            `${home}/Documents/Clients/Acme/Payroll`,
          ),
        },
      ],
    },
  });

  it.each([
    ["read", `${home}/Projects/notes.md`, "allow"],
    ["write", `${home}/Projects/notes.md`, "ask"],
    ["read", `${home}/Documents/Clients/Other/contract.pdf`, "ask"],
    ["write", `${home}/Documents/Clients/Acme/brief.md`, "allow"],
    ["read", `${home}/Documents/Clients/Acme/Payroll/june.csv`, "never"],
    ["read", `${home}/.ssh/id_ed25519`, "ask"],
    ["read", `${home}/.netrc`, "ask"],
    ["read", `${home}/Library/Keychains/login.keychain-db`, "never"],
    ["read", `${home}/Library/Application Support/Arc/User Data`, "never"],
    ["read", `${home}/.config/uv/uv.toml`, "ask"],
    ["read", `${home}/Library/Preferences/x.plist`, "ask"],
    ["write", `${home}/Documents/Instrument/out.png`, "allow"],
    ["read", "/Volumes/Backup/photos", "ask"],
    ["read", "/usr/bin/env", "allow"],
    ["write", "/opt/thing", "ask"],
  ] as const)("%s %s is %s", (op, target, level) => {
    expect(reachOf(rules, target, op).level).toBe(level);
  });

  it("turns asks into allows without asking but sign-ins', never never", () => {
    const relaxed = { ...rules, withoutAsking: true };
    expect(reachOf(relaxed, `${home}/Desktop/a.png`, "write").level).toBe(
      "allow",
    );
    expect(reachOf(relaxed, `${home}/.aws/credentials`, "read").level).toBe(
      "ask",
    );
    expect(
      reachOf(relaxed, `${home}/Library/Cookies/Cookies.binarycookies`, "read")
        .level,
    ).toBe("never");
  });

  it.each([
    ["allow", "allow", "allow"],
    ["never", "never", "never"],
    ["ask", "ask", "never"],
  ] as const)(
    "with the passwords place set to %s, sign-ins are %s and the Keychain %s",
    (place, signIns, keychain) => {
      const changed = rulesFor({
        home,
        settings: { ...settings, places: { passwords: place } },
      });
      expect(reachOf(changed, `${home}/.ssh/config`, "read").level).toBe(
        signIns,
      );
      expect(
        reachOf(changed, `${home}/Library/Keychains/x.keychain-db`, "read")
          .level,
      ).toBe(keychain);
    },
  );

  it("lets a grant open a sign-in folder", () => {
    const granted = rulesFor({
      grants: [
        {
          grantedAt: new Date(0),
          path: AbsolutePathSchema.parse(`${home}/.ssh`),
          source: "card",
        },
      ],
      home,
      settings,
    });
    expect(reachOf(granted, `${home}/.ssh/id_ed25519`, "read").level).toBe(
      "allow",
    );
    expect(reachOf(granted, `${home}/.gnupg/pubring.kbx`, "read").level).toBe(
      "ask",
    );
  });

  it("holds a not now over Use folders without asking", () => {
    const declined = rulesFor({
      denials: [`${home}/Desktop/Trip`],
      home,
      settings: { ...settings, withoutAsking: true },
    });
    const reach = reachOf(declined, `${home}/Desktop/Trip/a.png`, "read");
    expect(reach.level).toBe("never");
    expect(reach.rule?.denied).toBe(true);
    expect(reachOf(declined, `${home}/Desktop/b.png`, "read").level).toBe(
      "allow",
    );
  });

  it("lets an Always allow outrank a not now", () => {
    const allowedLater = rulesFor({
      denials: [`${home}/Desktop/Trip`],
      home,
      settings: {
        ...settings,
        folders: [
          {
            addedAt: new Date(0),
            level: "allow",
            path: AbsolutePathSchema.parse(`${home}/Desktop`),
          },
        ],
      },
    });
    expect(
      reachOf(allowedLater, `${home}/Desktop/Trip/a.png`, "read").level,
    ).toBe("allow");
  });
});

describe("folderToAskFor", () => {
  const documents = {
    level: "ask",
    path: `${home}/Documents`,
    source: "place",
  } as const;

  it.each([
    [
      `${home}/Documents/Clients/Acme/a.pdf`,
      false,
      `${home}/Documents/Clients`,
    ],
    [`${home}/Documents/report.pdf`, false, `${home}/Documents`],
    [`${home}/Documents/Clients`, true, `${home}/Documents/Clients`],
  ])("%s asks for %s", (hostPath, isDirectory, expected) => {
    expect(
      folderToAskFor({ home, hostPath, isDirectory, rule: documents }),
    ).toBe(expected);
  });

  it.each([
    [`${home}/.ssh/config`, `${home}/.ssh`],
    [`${home}/.ssh/keys/work/id_ed25519`, `${home}/.ssh`],
    [`${home}/.config/gh/hosts.yml`, `${home}/.config/gh`],
    [`${home}/.netrc`, `${home}/.netrc`],
    [`${home}/.docker/config.json`, `${home}/.docker/config.json`],
  ])("asks for a sign-in place whole: %s asks for %s", (hostPath, expected) => {
    const rules = rulesFor({ home, settings });
    expect(
      folderToAskFor({
        home,
        hostPath,
        isDirectory: false,
        rule: reachOf(rules, hostPath, "read").rule,
      }),
    ).toBe(expected);
  });

  it("asks one level below home where no rule holds the path", () => {
    expect(
      folderToAskFor({
        home,
        hostPath: `${home}/Projects/site/index.html`,
        isDirectory: false,
        rule: undefined,
      }),
    ).toBe(`${home}/Projects`);
  });
});

describe.runIf(process.platform !== "win32")("an allow above the home", () => {
  const plantedHome = "/scratch/run/home";
  const base = rulesFor({ home: plantedHome, settings });
  const rules = {
    ...base,
    rules: [
      ...base.rules,
      { level: "allow", path: "/scratch", source: "system" } as const,
    ],
  };

  it.each([
    ["write", "/scratch/notes.md", "allow"],
    ["read", `${plantedHome}/notes.md`, "allow"],
    ["write", `${plantedHome}/notes.md`, "ask"],
    ["write", `${plantedHome}/Documents/a.md`, "ask"],
  ] as const)("%s %s is %s", (op, target, level) => {
    expect(reachOf(rules, target, op).level).toBe(level);
  });
});
