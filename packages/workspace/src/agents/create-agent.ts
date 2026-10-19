import type { Agent, AgentName, AgentTools } from "./types";

export function setupAgent<T extends AgentTools, U extends AgentName>(options: {
  agentTools: T;
  name: U;
}): {
  create: (
    createAgent: (options: { agentTools: T; name: U }) => Omit<
      Agent<T>,
      "agentTools" | "getTools" | "name" | "toolNames"
    >,
  ) => Agent<T>;
} {
  return {
    create: (createAgent) => {
      const baseAgent = createAgent({
        agentTools: options.agentTools,
        name: options.name,
      });
      return {
        ...baseAgent,
        agentTools: options.agentTools,
        getTools: () => Promise.resolve(Object.values(options.agentTools)),
        name: options.name,
        tools: Object.values(options.agentTools),
      };
    },
  };
}
