import { call, os } from "@orpc/server";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { type InitialRPCContext } from "../context";
import { files } from "./files";

vi.mock("electron", () => ({ shell: {} }));
vi.mock("@/electron-main/rpc/base", () => ({ base: os }));

// Neither route reads its context, and the base it is built on is mocked
// out, so an empty one stands in for the window's.
const options = { context: {} as InitialRPCContext };

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), "files-route-"));
});
afterEach(async () => {
  await fs.rm(dir, { force: true, recursive: true });
});

it("lets only one of two writers holding the same version write", async () => {
  const file = path.join(dir, "doc.txt");
  await fs.writeFile(file, "base");
  const { version } = await call(files.read, { path: file }, options);

  const results = await Promise.all(
    ["first edit", "second edit"].map((content) =>
      call(files.write, { baseVersion: version, content, path: file }, options),
    ),
  );

  // Either may win; the loser gets the winner's text back to merge.
  const won = results.findIndex((r) => r.ok);
  const lost = results[1 - won];
  const winner = ["first edit", "second edit"][won];
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(lost).toMatchObject({ content: winner, ok: false });
  expect(await fs.readFile(file, "utf8")).toBe(winner);
});

// "café" in Windows-1252: the é is one byte, 0xE9, which is not UTF-8.
const LATIN_1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]);

it("reads a file that is not UTF-8 as not editable and refuses to write over it", async () => {
  const file = path.join(dir, "notes.md");
  await fs.writeFile(file, LATIN_1);
  const read = await call(files.read, { path: file }, options);
  expect(read).toMatchObject({ content: "caf\uFFFD", utf8: false });

  await expect(
    call(
      files.write,
      { baseVersion: read.version, content: "caf\uFFFD!", path: file },
      options,
    ),
  ).rejects.toMatchObject({ code: "NOT_UTF8" });
  await expect(
    call(files.write, { content: "replaced", path: file }, options),
  ).rejects.toMatchObject({ code: "NOT_UTF8" });
  expect(await fs.readFile(file)).toEqual(LATIN_1);
});

it("keeps a UTF-8 file's byte-order mark in what it reads", async () => {
  const file = path.join(dir, "bom.txt");
  await fs.writeFile(file, "\uFEFFhello");
  const read = await call(files.read, { path: file }, options);
  expect(read).toMatchObject({ content: "\uFEFFhello", utf8: true });
  const written = await call(
    files.write,
    { baseVersion: read.version, content: "\uFEFFhello!", path: file },
    options,
  );
  expect(written.ok).toBe(true);
});

it("creates a file that is not there yet", async () => {
  const file = path.join(dir, "new.md");
  const written = await call(
    files.write,
    { content: "new", path: file },
    options,
  );
  expect(written.ok).toBe(true);
  expect(await fs.readFile(file, "utf8")).toBe("new");
});
