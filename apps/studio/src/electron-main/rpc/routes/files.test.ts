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
