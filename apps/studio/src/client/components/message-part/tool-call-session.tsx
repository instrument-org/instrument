import { createContext, type ReactNode, useContext } from "react";

interface ToolCallSessionValue {
  /**
   * The command this call started outlived it and is still running.
   *
   * Separate from `isRunning`, which is the agent being on this call: a
   * promoted command runs on after the turn that started it ended, so the two
   * are true at different times and for different reasons.
   */
  isBackgroundRunning: boolean;
  /** The runtime is executing this call now; see `isToolPartRunning`. */
  isRunning: boolean;
  isStreaming: boolean;
}

const ToolCallSessionContext = createContext<null | ToolCallSessionValue>(null);

export function ToolCallSessionProvider({
  children,
  isBackgroundRunning,
  isRunning,
  isStreaming,
}: {
  children: ReactNode;
  isBackgroundRunning: boolean;
  isRunning: boolean;
  isStreaming: boolean;
}) {
  return (
    <ToolCallSessionContext.Provider
      value={{ isBackgroundRunning, isRunning, isStreaming }}
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
