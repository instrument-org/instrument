import { describe, expect, it } from "vitest";

import { FolderAttachment } from "../../schemas/folder-attachment";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { parseFlags, parseFolderSpec, resolveFolders } from "./task-args";

describe("parseFlags", () => {
  it("reads spaced and inline values, keeps the last of a flag given twice, and collects a repeatable one", () => {
    const { positional, values } = parseFlags(
      [
        "--name",
        "Lisbon",
        "--folder",
        "Home",
        "--folder=Instrument:rw",
        "--name=Porto",
        "the",
        "brief",
      ],
      { flags: ["folder", "model", "name"], repeatable: ["folder"] },
    );
    expect(positional).toEqual(["the", "brief"]);
    expect(Object.fromEntries(values)).toEqual({
      folder: ["Home", "Instrument:rw"],
      name: ["Porto"],
    });
  });

  it("leaves a flag it was not told about as a positional", () => {
    const { positional, values } = parseFlags(["--running", "x"], {
      flags: ["tail"],
      repeatable: [],
    });
    expect(positional).toEqual(["--running", "x"]);
    expect(values.size).toBe(0);
  });

  it("refuses a flag with nothing after it", () => {
    expect(() =>
      parseFlags(["--tail"], { flags: ["tail"], repeatable: [] }),
    ).toThrow("--tail needs a value.");
  });
});

describe("parseFolderSpec", () => {
  it.each([
    {
      expected: { access: undefined, name: "Home", subpath: "" },
      spec: "Home",
    },
    {
      expected: { access: undefined, name: "Home", subpath: "" },
      spec: "/mnt/Home/",
    },
    {
      expected: { access: "read-write", name: "Home", subpath: "Downloads" },
      spec: "Home/Downloads:rw",
    },
    {
      expected: { access: "read-only", name: "Instrument", subpath: "a/b" },
      spec: "/mnt/Instrument/a/b/:ro",
    },
    {
      expected: { access: "read-write", name: "Home", subpath: "" },
      spec: "Home:read-write",
    },
  ])("reads $spec", ({ expected, spec }) => {
    expect(parseFolderSpec(spec)).toEqual(expected);
  });
});

describe("resolveFolders", () => {
  createMockTaskConfig(TaskIdSchema.parse("orchestrator"));

  const attached = {
    Home: FolderAttachment.Schema.parse({
      access: "read-write",
      createdAt: 1,
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      mountName: "Home",
      path: "/Users/someone",
      source: "user",
    }),
    Notes: FolderAttachment.Schema.parse({
      access: "read-only",
      createdAt: 2,
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      mountName: "Notes",
      path: "/Volumes/Notes",
      source: "user",
    }),
  };

  it("hands a task the conversation's access unless the spec narrows it", () => {
    expect(resolveFolders(["Home", "Home/Downloads:ro"], attached)).toEqual([
      { access: "read-write", path: "/Users/someone", source: "user" },
      { access: "read-only", path: "/Users/someone/Downloads", source: "user" },
    ]);
  });

  it("refuses write access to a folder the conversation only reads", () => {
    expect(() => resolveFolders(["Notes:rw"], attached)).toThrow(
      "/mnt/Notes is read-only in this conversation",
    );
  });

  it("refuses a subpath that leaves the mount", () => {
    expect(() => resolveFolders(["Home/../../etc"], attached)).toThrow(
      '"Home/../../etc" leaves /mnt/Home',
    );
    expect(() => resolveFolders(["Home/Downloads/../.."], attached)).toThrow(
      "leaves /mnt/Home",
    );
  });

  it("keeps a subpath that only wanders inside the mount", () => {
    expect(resolveFolders(["Home/Downloads/../Desktop"], attached)).toEqual([
      { access: "read-write", path: "/Users/someone/Desktop", source: "user" },
    ]);
  });

  it("names the mounts it has when asked for one it does not", () => {
    expect(() => resolveFolders(["Desktop"], attached)).toThrow(
      'no folder "Desktop" in this conversation. Yours: /mnt/Home, /mnt/Notes',
    );
  });
});
