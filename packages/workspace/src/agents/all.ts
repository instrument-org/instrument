import { mainAgent } from "./main";
import { type AgentName, type AnyAgent } from "./types";

export const AGENTS = {
  main: mainAgent,
} as const satisfies Record<AgentName, AnyAgent>;
