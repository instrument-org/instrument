import { z } from "zod";

import { base } from "../../base";

const aliveAgentCount = base
  .input(z.void())
  .output(z.object({ count: z.number() }))
  .handler(({ context }) => {
    const { sessionRefsByChatId } = context.workspaceRef.getSnapshot().context;
    let count = 0;

    for (const sessionRefs of sessionRefsByChatId.values()) {
      for (const sessionRef of sessionRefs) {
        if (sessionRef.getSnapshot().hasTag("agent.alive")) {
          count += 1;
        }
      }
    }

    return { count };
  });

/** How many chats have an agent at work, in their own turn or a task's. */
const aliveChatCount = base
  .input(z.void())
  .output(z.object({ count: z.number() }))
  .handler(({ context }) => {
    const { sessionRefsByChatId } = context.workspaceRef.getSnapshot().context;
    let count = 0;
    for (const sessionRefs of sessionRefsByChatId.values()) {
      if (
        sessionRefs.some((sessionRef) =>
          sessionRef.getSnapshot().hasTag("agent.alive"),
        )
      ) {
        count += 1;
      }
    }
    return { count };
  });

export const agentStatus = {
  aliveAgentCount,
  aliveChatCount,
};
