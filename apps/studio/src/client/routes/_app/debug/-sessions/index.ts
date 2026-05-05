import { type SessionMessage } from "@instrument-org/workspace/client";

import { getRegisteredSessions } from "./helpers";

import.meta.glob("./data/*.ts", { eager: true });

interface PresetSession {
  id: string;
  messages: SessionMessage.WithParts[];
  name: string;
}

function presetSessionSortGroup(name: string): number {
  if (name === "Tools: Valid") {
    return 0;
  }
  if (name.startsWith("Error: ")) {
    return 2;
  }
  return 1;
}

export const presetSessions: PresetSession[] = [...getRegisteredSessions()]
  .sort((a, b) => {
    const ga = presetSessionSortGroup(a.name);
    const gb = presetSessionSortGroup(b.name);
    if (ga !== gb) {
      return ga - gb;
    }
    return a.name.localeCompare(b.name);
  })
  .map((session, index) => ({
    ...session,
    id: index.toString(),
  }));
