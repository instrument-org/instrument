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
