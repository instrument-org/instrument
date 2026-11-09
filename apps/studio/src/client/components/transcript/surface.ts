import { type StoreId } from "@instrument-org/workspace/client";
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
  /**
   * Its stretch ended at a message the chat sent while its step was still
   * running, so it stopped there without finishing.
   */
  handedOn?: boolean;
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
 * What the transcript does outside itself, and the picture of a page, so it
 * draws the same in the app and on the debug page, which does nothing outside
 * and draws a stand-in picture. What it reads comes from `transcript-data.ts`.
 */
export interface TranscriptSurface {
  PagePicture: ComponentType<{ sessionId: StoreId.Session }>;
  onOpenFile: (path: string) => void;
  onOpenTask: (id: StoreId.Session) => void;
  onOpenUrl: (url: string) => void;
  onStopCommand: (command: Pick<CommandFacts, "id" | "sessionId">) => void;
  onStopTask: (id: StoreId.Session) => void;
}

export const TranscriptSurfaceContext = createContext<
  TranscriptSurface | undefined
>(undefined);
