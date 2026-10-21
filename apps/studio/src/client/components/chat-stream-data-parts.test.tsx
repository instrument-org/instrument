import {
  type SessionMessagePart,
  StoreId,
} from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { dataPartVisibility, renderDataPart } from "./chat-stream-data-parts";
import { type RenderPartContext } from "./chat-stream-render-part";

const sessionId = StoreId.newSessionId();
const messageId = StoreId.newMessageId();

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
        stateNote: undefined,
        ctx: { isDeveloperMode: true } as unknown as RenderPartContext,
        part: retiredPart,
      }),
    ).toBeNull();
  });
});

/**
 * The one retired part that is still read.
 *
 * Written by the directory watcher, which reported everything a turn touched,
 * so what it holds is mostly the scratch the agent worked in. It survives
 * because a task from before the ` ```files ` fence has no other record of what
 * a turn produced, and it renders as the same grid a fence does.
 */
describe("a file-changes part from before the fence", () => {
  const partWith = (
    files: { filePath: string; status: string }[],
  ): SessionMessagePart.DataPart =>
    ({
      data: { files },
      metadata: {
        createdAt: new Date(0),
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-fileChanges",
    }) as unknown as SessionMessagePart.DataPart;

  const render = (
    part: SessionMessagePart.DataPart,
    pathsAlreadyShown?: ReadonlySet<string>,
  ) =>
    renderDataPart({
      stateNote: undefined,
      ctx: { isDeveloperMode: false } as unknown as RenderPartContext,
      part,
      pathsAlreadyShown,
    });

  it("shows a deliverable to everyone, not just developers", () => {
    expect(dataPartVisibility(partWith([]))).toBe("always");
    expect(
      render(partWith([{ filePath: "output/chart.png", status: "added" }])),
    ).not.toBeNull();
  });

  // The reason the card was worth deleting: `work/` is where the agent writes
  // the script that makes the deliverable, and the watcher reported all of it.
  it("draws nothing for a turn that only touched scratch", () => {
    expect(
      render(
        partWith([
          { filePath: "work/build.py", status: "added" },
          { filePath: "work/data.json", status: "modified" },
          { filePath: "attachments/logo.png", status: "added" },
        ]),
      ),
    ).toBeNull();
  });

  it("leaves out a file the turn deleted", () => {
    expect(
      render(partWith([{ filePath: "output/gone.png", status: "deleted" }])),
    ).toBeNull();
  });

  it("leaves out a file the reply already showed", () => {
    const part = partWith([{ filePath: "output/chart.png", status: "added" }]);

    expect(render(part)).not.toBeNull();
    expect(render(part, new Set(["output/chart.png"]))).toBeNull();
  });
});

/**
 * A task event in the chat is the cause of the reply that follows it, so it
 * stays a developer-mode row there; the note a quit or the user's stop leaves
 * starts no reply, so it is the only word a person gets that the task ended.
 */
describe("a task event in the chat", () => {
  const partWith = (stoppedBy?: "app" | "person") =>
    ({
      data: {
        events: [
          {
            sessionId,
            status: "done",
            ...(stoppedBy && { stoppedBy }),
            title: "Audit the vault",
          },
        ],
      },
      metadata: {
        createdAt: new Date(0),
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-taskEvent",
    }) as unknown as SessionMessagePart.DataPart;
  const rendered = (stoppedBy?: "app" | "person") =>
    renderDataPart({
      stateNote: undefined,
      ctx: {
        isDeveloperMode: false,
        presentation: "chat",
      } as unknown as RenderPartContext,
      part: partWith(stoppedBy),
    });

  it("hides one that woke the chat outside developer mode", () => {
    expect(rendered()).toBeNull();
  });

  it.each(["app", "person"] as const)(
    "shows a stop by %s to everyone, since no reply follows it",
    (stoppedBy) => {
      expect(rendered(stoppedBy)).not.toBeNull();
    },
  );
});
