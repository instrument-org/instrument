import { InMemoryFs } from "just-bash";
import { expect, it, vi } from "vitest";

import { rulesFs } from "./rules-fs";

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
  expect(refusals).toMatchInlineSnapshot(`
    [
      "/c/Users/sam/Documents/a.txt needs the person's yes first.",
      "/c/Users/sam/new.md needs the person's yes first.",
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
