import {
  type SessionMessage,
  type SessionMessagePart,
  StoreId,
} from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { instructionsChanges } from "./instructions-changes";

const sessionId = StoreId.newSessionId();

type Picture = {
  project?: {
    folders?: string[];
    id?: string;
    instructions?: string;
    name: string;
  } | null;
  workspace?: string;
};

const sent = (picture: Picture = {}): SessionMessage.WithParts => {
  const id = StoreId.newMessageId();
  const metadata = () => ({
    createdAt: new Date("2026-11-08T12:00:00Z"),
    id: StoreId.newPartId(),
    messageId: id,
    sessionId,
  });
  const parts: SessionMessagePart.Type[] = [
    { metadata: metadata(), text: "hi", type: "text" },
    ...(picture.project === undefined
      ? []
      : [
          {
            data: { project: picture.project },
            metadata: metadata(),
            type: "data-project" as const,
          },
        ]),
    ...("workspace" in picture
      ? [
          {
            data: {
              file: "AGENTS.md",
              ...(picture.workspace && { instructions: picture.workspace }),
            },
            metadata: metadata(),
            type: "data-workspaceInstructions" as const,
          },
        ]
      : []),
  ];
  return {
    id,
    metadata: { createdAt: new Date("2026-11-08T12:00:00Z"), sessionId },
    parts,
    role: "user",
  };
};

const changesOf = (pictures: Picture[]) => {
  const messages = pictures.map(sent);
  const changes = instructionsChanges(messages);
  return messages.map((message) => changes.get(message.id) ?? []);
};

const gaming = { id: "p1", name: "Gaming" };

describe("instructionsChanges", () => {
  it("says nothing of the picture a chat starts with", () => {
    expect(
      changesOf([
        { project: { ...gaming, instructions: "WoW" }, workspace: "Be brief" },
        { project: { ...gaming, instructions: "WoW" }, workspace: "Be brief" },
      ]),
    ).toEqual([[], []]);
  });

  it("names instructions updated and cleared in the same project", () => {
    expect(
      changesOf([
        { project: gaming },
        { project: { ...gaming, instructions: "WoW" } },
        { project: gaming },
      ]),
    ).toMatchInlineSnapshot(`
      [
        [],
        [
          {
            "foldersAdded": 0,
            "foldersRemoved": 0,
            "instructions": "updated",
            "kind": "project",
            "project": {
              "id": "p1",
              "instructions": "WoW",
              "name": "Gaming",
            },
          },
        ],
        [
          {
            "foldersAdded": 0,
            "foldersRemoved": 0,
            "instructions": "cleared",
            "kind": "project",
            "project": {
              "id": "p1",
              "name": "Gaming",
            },
          },
        ],
      ]
    `);
  });

  it("counts folders added and removed", () => {
    expect(
      changesOf([
        { project: { ...gaming, folders: ["/a", "/b"] } },
        { project: { ...gaming, folders: ["/b", "/c", "/d"] } },
      ])[1],
    ).toMatchInlineSnapshot(`
      [
        {
          "foldersAdded": 2,
          "foldersRemoved": 1,
          "kind": "project",
          "project": {
            "folders": [
              "/b",
              "/c",
              "/d",
            ],
            "id": "p1",
            "name": "Gaming",
          },
        },
      ]
    `);
  });

  it("reads a move, a removal, and a filing after the chat began", () => {
    expect(
      changesOf([
        {},
        { project: gaming },
        { project: { id: "p2", name: "Work" } },
        { project: null },
      ]).map((found) => found.map((change) => change.kind)),
    ).toEqual([[], ["filed"], ["filed"], ["unfiled"]]);
  });

  it("keeps a renamed project the same one by its id", () => {
    expect(
      changesOf([
        { project: gaming },
        { project: { id: "p1", name: "Games" } },
      ]),
    ).toEqual([[], []]);
  });

  it("reads a rename as a move on parts stored without an id", () => {
    expect(
      changesOf([
        { project: { name: "Gaming" } },
        { project: { name: "Games" } },
      ]).map((found) => found.map((change) => change.kind)),
    ).toEqual([[], ["filed"]]);
  });

  it("names the workspace's instructions written after the chat began, and cleared", () => {
    expect(
      changesOf([{}, { workspace: "Be brief" }, { workspace: "" }]),
    ).toEqual([
      [],
      [{ instructions: "updated", kind: "workspace" }],
      [{ instructions: "cleared", kind: "workspace" }],
    ]);
  });
});
