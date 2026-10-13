import { type StoreId, type ChatId } from "@instrument-org/workspace/client";
import { createContext, type ReactNode, useContext } from "react";

interface ChatSession {
  sessionId?: StoreId.Session;
  chatId?: ChatId;
}

const ChatSessionContext = createContext<ChatSession>({});

/**
 * Names the task and session everything drawn inside belongs to.
 *
 * A context rather than a prop because what reads it is a link, and links are
 * the one thing every surface in a task has: the transcript, a tool's output,
 * a model's reasoning, the sources under an answer, a Markdown file open in the
 * pane. Threading a task and a session to each of those would mean touching
 * every component in between, all of which are only in the way.
 *
 * Empty outside a task, which is what an anchor there degrades against.
 */
export function ChatSessionProvider({
  children,
  sessionId,
  chatId,
}: ChatSession & { children: ReactNode }) {
  return (
    <ChatSessionContext value={{ sessionId, chatId }}>
      {children}
    </ChatSessionContext>
  );
}

/**
 * The task and session in scope, if there is one.
 *
 * Both fields or neither is what callers actually want: the task's browser is
 * one guest per task and session, so a task without a session names no browser
 * to open anything in.
 */
export function useChatSession(): ChatSession {
  return useContext(ChatSessionContext);
}
