import { describe, expect, it } from "vitest";

import { type SessionMessagePart } from "../../schemas/session/message-part";
import { localPart, portablePart } from "./part-paths";
import { at, messageId, partId, sessionId } from "./test-records";

const metadata = {
  createdAt: at(1),
  id: partId(1),
  messageId: messageId(1),
  sessionId: sessionId(1),
};

function chosen(path: string, mount?: string): SessionMessagePart.Type {
  return {
    data: {
      chosen: [
        { kind: "file", name: "plan.md", path, ...(mount && { mount }) },
      ],
      screen: "chat",
    },
    metadata,
    type: "data-viewContext",
  };
}

describe("part paths", () => {
  it.each([
    [
      "a Mac's workspace",
      "/Users/sam/Instrument",
      "/Users/sam/Instrument/Chats/Plan/plan.md",
    ],
    [
      "a Windows workspace",
      "C:\\Users\\sam\\Instrument",
      "C:\\Users\\sam\\Instrument\\Chats\\Plan\\plan.md",
    ],
  ])("keep a file in %s by its place there", (_, root, host) => {
    const kept = portablePart(chosen(host, host), root);

    expect(kept).toEqual(
      chosen("workspace:/Chats/Plan/plan.md", "workspace:/Chats/Plan/plan.md"),
    );
    expect(localPart(kept, root)).toEqual(chosen(host, host));
  });

  it("keeps a file outside the workspace at its own path", () => {
    const part = chosen("/Users/sam/Desktop/plan.md");

    expect(portablePart(part, "/Users/sam/Instrument")).toBe(part);
  });

  // Every path the app puts in a part is in the synced log; one left as this
  // Mac's host path names nothing on the other computer.
  const ROOT = "/Users/mac-user/Instrument";
  const inside = (name: string) => `${ROOT}/Chats/Plan/${name}`;
  it.each<[string, SessionMessagePart.Type]>([
    [
      "an ask's file and mount",
      {
        data: {
          asks: [
            {
              file: {
                mount: `${ROOT}/Chats/Plan`,
                name: "a.md",
                path: inside("a.md"),
              },
              instruction: "",
              target: "whole file",
            },
          ],
        },
        metadata,
        type: "data-asks",
      },
    ],
    [
      "a folder sent with the message",
      {
        data: { files: [], folders: [{ path: inside("sent") }] },
        metadata,
        type: "data-attachments",
      },
    ],
    [
      "folders granted and taken back",
      {
        data: {
          added: [{ path: inside("added") }],
          removed: [{ path: inside("removed") }],
        },
        metadata,
        type: "data-folderChanges",
      },
    ],
    [
      "a folder card's answer",
      {
        data: { answer: "allowed", kind: "folder", target: inside("asked") },
        metadata,
        type: "data-permissionAnswer",
      },
    ],
    [
      "the files a task named",
      {
        data: {
          events: [
            {
              files: [inside("made.md")],
              sessionId: sessionId(2),
              status: "done",
              title: "t",
            },
          ],
        },
        metadata,
        type: "data-taskEvent",
      },
    ],
    [
      "the folders of the chat's project",
      {
        data: { project: { folders: [inside("filed")], name: "Plan" } },
        metadata,
        type: "data-project",
      },
    ],
    [
      "what was attached, open and shown",
      {
        data: {
          attached: [
            {
              items: [{ kind: "file", path: inside("chip.md") }],
              kind: "paths",
            },
          ],
          file: {
            mount: `${ROOT}/Chats/Plan`,
            name: "open.md",
            path: inside("open.md"),
          },
          folder: {
            display: "Plan",
            mount: `${ROOT}/Chats/Plan`,
            selected: [],
          },
          screen: "file",
        },
        metadata,
        type: "data-viewContext",
      },
    ],
  ])("keep %s by its place in the workspace", (_, part) => {
    const kept = portablePart(part, ROOT);

    expect(JSON.stringify(kept)).not.toContain(ROOT);
    expect(localPart(kept, ROOT)).toEqual(part);
  });

  it("leaves an app card's answer, which names no path, as it is", () => {
    const part: SessionMessagePart.Type = {
      data: { answer: "allowed", kind: "app", target: `${ROOT}/Not a path` },
      metadata,
      type: "data-permissionAnswer",
    };
    expect(portablePart(part, ROOT)).toBe(part);
  });

  // A part an earlier build wrote reads as it was written.
  it("reads a part with no workspace paths as it is", () => {
    const part = chosen("/Users/sam/Instrument/plan.md");

    expect(localPart(part, "/home/sam/work")).toBe(part);
  });
});
