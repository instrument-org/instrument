import {
  type SessionMessagePart,
  type StepPart,
  type StoreId,
  type TranscriptMessage,
} from "@instrument-org/workspace/client";
import { type ComponentType, createContext } from "react";

/** What a task's card says of it, wherever that comes from. */
export interface TaskCardFacts {
  /** The line it finished on. */
  ended?: string;
  failed: boolean;
  /**
   * The chat has no such task: a branch's copy of a card whose task stayed
   * with the chat it came from. Its card is finished and opens nothing.
   */
  gone?: boolean;
  /** How long its card's stretch of the task took, once that has ended. */
  ranMs?: number;
  /** When its card's stretch of the task began, once the task's log says. */
  startedAt?: Date;
  /** What it is doing now. */
  step?: string;
  stoppable: boolean;
  title: string;
  /** It stopped on something the person has to answer, which its line names. */
  waiting?: boolean;
  working: boolean;
}

/** A command the agent left going, or that has since ended. */
export interface CommandFacts {
  command: string;
  /** What the agent called it. */
  explanation?: string;
  id: string;
  /** How long it ran, once it has ended. */
  ranMs?: number;
  /** The session that started it, whose own its id is. */
  sessionId: StoreId.Session;
  startedAt: Date;
}

/**
 * What the transcript reads from outside what it is handed, so it draws the
 * same in the app and on the debug page, which supplies scripted answers: the
 * call behind an opened step, the picture of a page, the commands left going,
 * and a task's standing and messages.
 */
export interface TranscriptSurface {
  PagePicture: ComponentType<{ sessionId: StoreId.Session }>;
  onOpenFile: (path: string) => void;
  onOpenTask: (id: StoreId.Session) => void;
  onOpenUrl: (url: string) => void;
  onStopCommand: (command: Pick<CommandFacts, "id" | "sessionId">) => void;
  onStopTask: (id: StoreId.Session) => void;
  /**
   * The page a session's work is on, as its tab says it is; nothing is read
   * while `sessionId` is absent.
   */
  useDrivenPage: (
    sessionId: StoreId.Session | undefined,
  ) => { title?: string; url?: string } | undefined;
  /** Where the paths a call named are on this computer, once that is known. */
  useHostPaths: (paths: readonly string[]) => Record<string, null | string>;
  /** The commands the chat and its tasks left going, and those that have since ended. */
  useCommands: () => readonly CommandFacts[];
  useStepPart: (
    step: StepPart,
    isOpen: boolean,
  ) =>
    | SessionMessagePart.ReasoningPart
    | SessionMessagePart.ToolPart
    | undefined;
  /**
   * What a task's card says: the stretch of its log from `from`, the message
   * a send put there, or from its start without one.
   */
  useTaskFacts: (
    id: StoreId.Session,
    from?: StoreId.Message,
  ) => TaskCardFacts | undefined;
  useTaskMessages: (
    id: StoreId.Session,
    isWorking: boolean,
  ) => readonly TranscriptMessage[];
}

export const TranscriptSurfaceContext = createContext<
  TranscriptSurface | undefined
>(undefined);
