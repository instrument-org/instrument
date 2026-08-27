import { type RunningBackgroundProcess } from "@/client/hooks/use-task-background-processes";
import { createContext, type ReactNode, useContext } from "react";

interface ToolCallSessionValue {
  /**
   * Set while the command this call started is still running, having outlived
   * the call.
   *
   * Separate from `isRunning`, which is the agent being on this call: a
   * promoted command runs on after the turn that started it ended, so the two
   * are true at different times and for different reasons.
   */
  backgroundProcess: RunningBackgroundProcess | undefined;
  /** The runtime is executing this call now; see `isToolPartRunning`. */
  isRunning: boolean;
  isStreaming: boolean;
}

const ToolCallSessionContext = createContext<null | ToolCallSessionValue>(null);

export function ToolCallSessionProvider({
  backgroundProcess,
  children,
  isRunning,
  isStreaming,
}: {
  backgroundProcess: RunningBackgroundProcess | undefined;
  children: ReactNode;
  isRunning: boolean;
  isStreaming: boolean;
}) {
  return (
    <ToolCallSessionContext.Provider
      value={{ backgroundProcess, isRunning, isStreaming }}
    >
      {children}
    </ToolCallSessionContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToolCallSession(): ToolCallSessionValue {
  const value = useContext(ToolCallSessionContext);
  if (!value) {
    throw new Error(
      "useToolCallSession must be used within ToolCallSessionProvider",
    );
  }
  return value;
}
