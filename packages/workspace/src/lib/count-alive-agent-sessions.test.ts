import { describe, expect, it } from "vitest";
import { createActor, setup } from "xstate";

import { type WorkspaceActorRef } from "../machines/workspace";
import {
  countAliveAgentSessions,
  hasAliveAgentSessions,
} from "./count-alive-agent-sessions";

function createTaggedSession(tag: "agent.alive" | "agent.done") {
  const sessionMachine = setup({
    types: {
      tags: {} as "agent.alive" | "agent.done",
    },
  }).createMachine({
    initial: tag === "agent.alive" ? "alive" : "done",
    states: {
      alive: {
        tags: ["agent.alive"],
      },
      done: {
        tags: ["agent.done"],
        type: "final",
      },
    },
  });

  const ref = createActor(sessionMachine);
  ref.start();
  return ref;
}

function createTestWorkspaceRef(
  sessionRefsBySubdomain: Map<string, ReturnType<typeof createTaggedSession>[]>,
) {
  const workspaceRef = createActor(
    setup({
      types: {
        context: {} as {
          sessionRefsBySubdomain: Map<
            string,
            ReturnType<typeof createTaggedSession>[]
          >;
        },
      },
    }).createMachine({
      context: { sessionRefsBySubdomain },
      id: "workspace",
      initial: "ready",
      states: { ready: {} },
    }),
  );
  workspaceRef.start();
  // Test machine only implements sessionRefsBySubdomain from WorkspaceContext.
  return workspaceRef as unknown as WorkspaceActorRef;
}

describe("countAliveAgentSessions", () => {
  it("returns 0 when no sessions exist", () => {
    const workspaceRef = createTestWorkspaceRef(new Map());

    expect(countAliveAgentSessions(workspaceRef)).toBe(0);
    expect(hasAliveAgentSessions(workspaceRef)).toBe(false);
  });

  it("counts only sessions tagged agent.alive", () => {
    const workspaceRef = createTestWorkspaceRef(
      new Map([
        [
          "project-a",
          [
            createTaggedSession("agent.alive"),
            createTaggedSession("agent.done"),
          ],
        ],
        ["project-b", [createTaggedSession("agent.alive")]],
      ]),
    );

    expect(countAliveAgentSessions(workspaceRef)).toBe(2);
    expect(hasAliveAgentSessions(workspaceRef)).toBe(true);
  });
});
