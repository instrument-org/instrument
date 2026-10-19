import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { finishedWorkFolder } from "./output-folder";

const held = getWorkspaceConfig();
const picked = path.join(os.homedir(), "Documents", "Instrument");

afterEach(() => {
  setWorkspaceConfig(held);
});

/** A workspace the person picked where it is kept, so its top level is theirs. */
function workspaceTheyPicked(): void {
  setWorkspaceConfig({
    ...held,
    outputDir: AbsolutePathSchema.parse(picked),
  });
}

describe("finishedWorkFolder", () => {
  it("is the chat's own folder when that folder is in the person's Instrument folder", () => {
    workspaceTheyPicked();

    expect(
      finishedWorkFolder(path.join(picked, "Chats", "Quiet dishwashers")),
    ).toBe(path.join(picked, "Chats", "Quiet dishwashers"));
  });

  it("is the Instrument folder for a chat whose folder is somewhere else", () => {
    // Every workspace kept in the app's own data: its `Chats/` is somewhere
    // the person never opens, and the rules ask about the app's data rather
    // than allow it, so finished work goes where they will find it and the
    // agent may write.
    workspaceTheyPicked();

    expect(
      finishedWorkFolder(
        path.join(
          os.homedir(),
          "Library",
          "Application Support",
          "Instrument",
          "workspace",
          "Chats",
          "Quiet dishwashers",
        ),
      ),
    ).toBe(picked);
  });

  it("is the Instrument folder for a chat with no folder, and for the window", () => {
    workspaceTheyPicked();

    expect(finishedWorkFolder(undefined)).toBe(picked);
  });
});
