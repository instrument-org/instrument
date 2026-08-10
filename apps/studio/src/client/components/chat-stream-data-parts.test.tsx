import {
  type SessionMessagePart,
  StoreId,
} from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  dataPartVisibility,
  renderDataPart,
} from "./chat-stream-data-parts";
import { type RenderPartContext } from "./chat-stream-render-part";

const sessionId = StoreId.newSessionId();
const messageId = StoreId.newMessageId();

function fileChangesPart(
  files: { filePath: string; status?: "added" | "deleted" | "modified" }[],
): SessionMessagePart.DataPart {
  return {
    data: {
      files: files.map(({ filePath, status = "added" }) => ({
        filename: filePath.split("/").at(-1) ?? filePath,
        // Branded relative path; `as never` skips the client-side schema
        // validation the same way the session fixtures do.
        filePath: filePath as never,
        mimeType: "text/markdown",
        modifiedAt: 0,
        size: 1,
        status,
      })),
    },
    metadata: {
      createdAt: new Date(0),
      id: StoreId.newPartId(),
      messageId,
      sessionId,
    },
    type: "data-fileChanges",
  };
}

// A file-changes part reaches developer mode at most, since the ```files fence
// is what shows a turn's files to the user now. What is still worth separating
// is whether the part has anything to draw at all: `dev` renders a card for a
// developer, `hidden` renders nothing for anyone.
describe("dataPartVisibility", () => {
  it.each([
    {
      expected: "dev",
      label: "output deliverable",
      paths: ["output/report.md"],
    },
    { expected: "dev", label: "root-level file", paths: ["report.md"] },
    { expected: "dev", label: "download", paths: ["downloads/logo.png"] },
    {
      expected: "dev",
      label: "one surfaced path among hidden ones",
      paths: ["work/src/app.tsx", "output/report.md"],
    },
    {
      expected: "hidden",
      label: "skill files copied into work/",
      paths: [
        "work/skills/instrument/agent-browser/references/commands.md",
        "work/skills/instrument/agent-browser/references/profiling.md",
      ],
    },
    { expected: "hidden", label: "root dotfile", paths: [".gitignore"] },
    { expected: "hidden", label: "no files at all", paths: [] },
  ])("is $expected for $label", ({ expected, paths }) => {
    expect(
      dataPartVisibility(
        fileChangesPart(paths.map((filePath) => ({ filePath }))),
      ),
    ).toBe(expected);
  });

  it("is hidden when every surfaced file was deleted", () => {
    expect(
      dataPartVisibility(
        fileChangesPart([{ filePath: "output/report.md", status: "deleted" }]),
      ),
    ).toBe("hidden");
  });
});

/**
 * A part outlives the feature that wrote it. `data-gitCommit` is still sitting
 * in tasks from before git-based file versioning was removed, and parts are cast
 * to their type on read rather than parsed, so one reaches the transcript with a
 * type nothing here has a case for.
 *
 * It used to reach the renderer's exhaustiveness check, which returned the part
 * itself -- React was handed an object as a child and the whole transcript went
 * down rather than the one row.
 */
describe("a data part this build has never heard of", () => {
  const retiredPart = {
    data: { ref: "abc123" },
    metadata: {
      createdAt: new Date(0),
      id: StoreId.newPartId(),
      messageId,
      sessionId,
    },
    type: "data-gitCommit",
  } as unknown as SessionMessagePart.DataPart;

  it("draws nothing", () => {
    expect(dataPartVisibility(retiredPart)).toBe("hidden");
  });

  it("renders as nothing rather than as itself", () => {
    expect(
      renderDataPart({
        browserStatusContextAdded: false,
        ctx: { isDeveloperMode: true } as unknown as RenderPartContext,
        part: retiredPart,
      }),
    ).toBeNull();
  });
});
