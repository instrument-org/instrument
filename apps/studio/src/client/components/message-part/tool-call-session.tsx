import { createContext, type ReactNode, useContext } from "react";

interface ToolCallSessionValue {
  /** The runtime is executing this call now; see `isToolPartRunning`. */
  isRunning: boolean;
  isStreaming: boolean;
}

const ToolCallSessionContext = createContext<null | ToolCallSessionValue>(null);

export function ToolCallSessionProvider({
  children,
  isRunning,
  isStreaming,
}: {
  children: ReactNode;
  isRunning: boolean;
  isStreaming: boolean;
}) {
  return (
    <ToolCallSessionContext.Provider value={{ isRunning, isStreaming }}>
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
