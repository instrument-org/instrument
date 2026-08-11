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
        browserStatusContextAdded: false,
        ctx: { isDeveloperMode: true } as unknown as RenderPartContext,
        part: retiredPart,
      }),
    ).toBeNull();
  });
});
