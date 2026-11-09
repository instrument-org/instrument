import Store from "electron-store";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { z } from "zod";

import { storeJson } from "./store-json";

const Schema = z.object({ channel: z.string().default("latest") });
type Shape = z.output<typeof Schema>;

let dir = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "store-json-"));
});
afterEach(() => {
  fs.rmSync(dir, { force: true, recursive: true });
});

/** A store that reads its file the way the app's plain stores do. */
const open = () =>
  new Store<Shape>({
    cwd: dir,
    defaults: Schema.parse({}),
    deserialize: (value) => {
      const parsed = Schema.safeParse(storeJson(value));
      return parsed.success ? parsed.data : Schema.parse({});
    },
    name: "preferences",
  });

it.each([
  ["empty", ""],
  ["cut short", '{"channel":"be'],
])("opens on its defaults over a file that is %s", (_, contents) => {
  fs.writeFileSync(path.join(dir, "preferences.json"), contents);

  expect(open().get("channel")).toBe("latest");
});

it("reads a file that is whole", () => {
  fs.writeFileSync(path.join(dir, "preferences.json"), '{"channel":"beta"}');

  expect(open().get("channel")).toBe("beta");
});
