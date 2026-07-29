import {
  type SessionMessagePart,
  StoreId,
} from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { dataPartVisibility } from "./chat-stream-data-parts";

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

describe("dataPartVisibility", () => {
  it.each([
    {
      expected: "always",
      label: "output deliverable",
      paths: ["output/report.md"],
    },
    { expected: "always", label: "root-level file", paths: ["report.md"] },
    { expected: "always", label: "download", paths: ["downloads/logo.png"] },
    {
      expected: "always",
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
