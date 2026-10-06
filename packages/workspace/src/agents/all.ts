import { instrumentAgent } from "./instrument";
import { mainAgent } from "./main";
import { oneAgent } from "./one";
import { type AgentName, type AnyAgent } from "./types";

export const AGENTS = {
  instrument: instrumentAgent,
  "instrument-one": oneAgent,
  main: mainAgent,
} as const satisfies Record<AgentName, AnyAgent>;
