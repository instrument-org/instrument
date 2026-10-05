import { z } from "zod";

import { base } from "../../base";

const aliveAgentCount = base
  .input(z.void())
  .output(z.object({ count: z.number() }))
  .handler(({ context }) => {
    const { sessionRefsByTaskId } = context.workspaceRef.getSnapshot().context;
    let count = 0;

    for (const sessionRefs of sessionRefsByTaskId.values()) {
      for (const sessionRef of sessionRefs) {
        if (sessionRef.getSnapshot().hasTag("agent.alive")) {
          count += 1;
        }
      }
    }

    return { count };
  });

export const taskAgentStatus = {
  aliveAgentCount,
};
