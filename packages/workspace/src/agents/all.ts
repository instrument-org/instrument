import { instrumentAgent } from "./instrument";
import { mainAgent } from "./main";
import { type AgentName, type AnyAgent } from "./types";

export const AGENTS = {
  instrument: instrumentAgent,
  main: mainAgent,
} as const satisfies Record<AgentName, AnyAgent>;
