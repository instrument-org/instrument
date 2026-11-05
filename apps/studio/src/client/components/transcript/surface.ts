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
  /** How long it took, once it has finished. */
  ranMs?: number;
  /** What it is doing now. */
  step?: string;
  stoppable: boolean;
  title: string;
  working: boolean;
}

/**
 * What the transcript reads from outside what it is handed, so it draws the
 * same in the app and on the debug page, which supplies scripted answers: the
 * call behind an opened step, the picture of a page, the commands still running,
 * and a task's standing and messages.
 */
export interface TranscriptSurface {
  PagePicture: ComponentType<{ sessionId: StoreId.Session }>;
  onOpenFile: (path: string) => void;
  onOpenTask: (id: StoreId.Session) => void;
  onOpenUrl: (url: string) => void;
  onStopTask: (id: StoreId.Session) => void;
  /** Where the paths a call named are on this computer, once that is known. */
  useHostPaths: (paths: readonly string[]) => Record<string, null | string>;
  /** The ids of the commands the chat and its tasks left running. */
  useRunningCommands: () => ReadonlySet<string>;
  useStepPart: (
    step: StepPart,
    isOpen: boolean,
  ) =>
    | SessionMessagePart.ReasoningPart
    | SessionMessagePart.ToolPart
    | undefined;
  useTaskFacts: (id: StoreId.Session) => TaskCardFacts | undefined;
  useTaskMessages: (
    id: StoreId.Session,
    isWorking: boolean,
  ) => readonly TranscriptMessage[];
}

export const TranscriptSurfaceContext = createContext<
  TranscriptSurface | undefined
>(undefined);
