import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import Store, { rememberStoreReads } from "./store";

type Shape = { list: string[]; name: string };

let dir = "";
let reads = 0;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "store-"));
  reads = 0;
});
afterEach(() => {
  fs.rmSync(dir, { force: true, recursive: true });
});

const open = () =>
  new Store<Shape>({
    cwd: dir,
    defaults: { list: [], name: "first" },
    deserialize: (value) => {
      reads += 1;
      return JSON.parse(value) as Shape;
    },
    name: "test",
  });

it("reads its file on every get before reads are remembered", () => {
  const store = open();
  reads = 0;

  store.get("name");
  store.get("name");

  expect(reads).toBe(2);
});

describe("remembering reads", () => {
  beforeAll(() => {
    rememberStoreReads(() => true);
  });

  it("answers repeated gets without reading the file", () => {
    const store = open();
    store.get("name");
    reads = 0;

    store.get("name");
    store.get("list");

    expect(reads).toBe(0);
  });

  it("reads what it wrote once, through its deserialize", () => {
    const store = open();
    store.set("name", "second");
    reads = 0;

    expect(store.get("name")).toBe("second");
    expect(store.get("name")).toBe("second");
    expect(reads).toBe(1);
  });

  it("reads a file another writer changed", () => {
    const store = open();
    store.get("name");

    fs.writeFileSync(
      store.path,
      JSON.stringify({ list: [], name: "from elsewhere" }),
    );

    expect(store.get("name")).toBe("from elsewhere");
  });

  it("reads a file another store on it wrote", () => {
    const one = open();
    const other = open();
    one.get("name");

    other.set("name", "other");

    expect(one.get("name")).toBe("other");
  });

  it("answers a copy, so changing a value read changes nothing stored", () => {
    const store = open();

    store.get("list").push("stray");

    expect(store.get("list")).toEqual([]);
  });

  it("tells change listeners the old and new value", () => {
    const store = open();
    const changes: [unknown, unknown][] = [];
    store.onDidChange("list", (now, before) => changes.push([now, before]));

    store.set("list", ["a"]);
    store.set("list", ["a", "b"]);

    expect(changes).toEqual([
      [["a"], []],
      [["a", "b"], ["a"]],
    ]);
  });
});
