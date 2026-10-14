import { InMemoryFs } from "just-bash";
import { expect, it, vi } from "vitest";

import { closedNote, rulesFs } from "./rules-fs";
import { type Rule } from "./rules";

// The rules below hold a made-up home, which nothing on this disk lets the
// account change.
vi.mock("./account-can-write", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./account-can-write")>()),
  accountCanWrite: () => true,
}));

it("refuses what the rules close, reports it, and leaves the rest alone", async () => {
  const delegate = new InMemoryFs({
    "/Documents/a.txt": "a",
    "/notes.md": "n",
  });
  const refusals: string[] = [];
  const fs = rulesFs({
    delegate,
    hostRoot: "/Users/sam",
    onRefusal: (refusal) => refusals.push(refusal),
    rules: {
      home: "/Users/sam",
      rules: [{ level: "ask", path: "/Users/sam/Documents", source: "place" }],
      withoutAsking: false,
    },
    spell: (hostPath) => hostPath.replace("/Users/sam", "/c/Users/sam"),
  });

  expect(await fs.readFile("/notes.md")).toBe("n");
  expect(await fs.exists("/Documents")).toBe(true);
  await expect(fs.readFile("/Documents/a.txt")).rejects.toThrow(/EACCES/);
  await expect(fs.writeFile("/new.md", "x")).rejects.toThrow(/EACCES/);
  await expect(fs.mkdir("/newproj")).rejects.toThrow(/EACCES/);
  expect(refusals).toMatchInlineSnapshot(`
    [
      "/c/Users/sam/Documents/a.txt needs the person's yes first.",
      "/c/Users/sam/new.md is directly in /c/Users/sam, which no card can open whole. Work in this conversation's folder, or a folder the person names.",
      "/c/Users/sam/newproj needs the person's yes first.",
    ]
  `);
});

it("lets cd pass through a hidden folder to a folder inside it the agent reaches", async () => {
  const fs = rulesFs({
    delegate: new InMemoryFs({
      "/ws/chats/a/work/x.txt": "x",
      "/ws/chats/b/secret.txt": "s",
    }),
    hostRoot: "/tmp",
    rules: {
      home: "/Users/sam",
      rules: [
        { level: "hidden", path: "/tmp/ws", source: "system" },
        { level: "allow", path: "/tmp/ws/chats/a", source: "system" },
      ],
      withoutAsking: false,
    },
    spell: (hostPath) => hostPath,
  });

  expect((await fs.stat("/ws/chats")).isDirectory).toBe(true);
  expect(await fs.exists("/ws")).toBe(true);
  expect(await fs.readFile("/ws/chats/a/work/x.txt")).toBe("x");
  await expect(fs.readdir("/ws/chats")).rejects.toThrow(/ENOENT/);
  await expect(fs.stat("/ws/chats/b")).rejects.toThrow(/ENOENT/);
  expect(await fs.exists("/ws/chats/b/secret.txt")).toBe(false);
});

it("checks a hard link's source as a change, since writing the link writes it", async () => {
  const fs = rulesFs({
    delegate: new InMemoryFs({
      "/repo/.claude/settings.json": "{}",
      "/repo/notes.md": "n",
    }),
    hostRoot: "/Users/sam",
    rules: {
      home: "/Users/sam",
      rules: [{ level: "allow", path: "/Users/sam/repo", source: "grant" }],
      withoutAsking: false,
    },
    spell: (hostPath) => hostPath,
  });

  await expect(
    fs.link("/repo/.claude/settings.json", "/repo/h"),
  ).rejects.toThrow(/EACCES/);
  await expect(fs.link("/repo/notes.md", "/repo/n")).resolves.toBeUndefined();
});

it("says why each kind of closed path is closed", () => {
  const rules: [string, Rule | undefined][] = [
    [
      "not now",
      { denied: true, level: "never", path: "/h/D", source: "grant" },
    ],
    ["read-only", { level: "readOnly", path: "/h/S", source: "system" }],
    ["runs at login", { level: "never", path: "/h/.zshrc", source: "system" }],
    [
      "runs code, allowed folder",
      { level: "allow", path: "/h/repo", source: "grant" },
    ],
    ["runs code, no rule", undefined],
    [
      "closed in Settings",
      {
        level: "never",
        path: "/h/Library/Cookies",
        place: "passwords",
        source: "place",
      },
    ],
  ];
  expect(
    Object.fromEntries(
      rules.map(([name, rule]) => [
        name,
        closedNote({ level: "never", rule }, "/h/x"),
      ]),
    ),
  ).toMatchInlineSnapshot(`
    {
      "closed in Settings": "/h/x is closed in Settings › Permissions. Don't look for another way in; tell the person what you needed it for.",
      "not now": "/h/x: the person said not now to this folder in this chat. Don't look for another way in; say what you skipped without it.",
      "read-only": "/h/x is read-only. Copy what you need out of it and change the copy.",
      "runs at login": "/h/x runs every time the person logs in or opens a terminal, so it is never changed for them, whatever their settings. Tell them what to add and they can add it themselves.",
      "runs code, allowed folder": "/h/x makes code run when its folder is used (a git hook, .envrc, or an editor's or coding agent's settings), so it is never changed, moved or removed outside this chat's own folder. The rest of the folder, and git commands like commit and checkout, still work.",
      "runs code, no rule": "/h/x makes code run when its folder is used (a git hook, .envrc, or an editor's or coding agent's settings), so it is never changed, moved or removed outside this chat's own folder. The rest of the folder, and git commands like commit and checkout, still work.",
    }
  `);
});
