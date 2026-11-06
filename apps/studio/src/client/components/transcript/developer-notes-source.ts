import { rpcClient } from "@/client/rpc/client";
import {
  type ChatId,
  type DeveloperNote,
  type StoreId,
} from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { createContext } from "react";

/**
 * Where the notes layer reads a session's notes: the app's records, or the
 * script a debug page plays, which has no records under it.
 */
export interface DeveloperNotesSource {
  useNotes: (input: {
    chatId: ChatId;
    sessionId: StoreId.Session;
  }) => readonly DeveloperNote[];
}

const NONE: readonly DeveloperNote[] = [];

export const DeveloperNotesSourceContext = createContext<DeveloperNotesSource>({
  useNotes: ({ chatId, sessionId }) =>
    useQuery(
      rpcClient.workspace.message.live.developerNotes.experimental_liveOptions({
        input: { id: chatId, sessionId },
      }),
    ).data ?? NONE,
});
