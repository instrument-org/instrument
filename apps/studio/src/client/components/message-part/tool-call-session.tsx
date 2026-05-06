import { createContext, type ReactNode, useContext } from "react";

interface ToolCallSessionValue {
  isAgentRunning: boolean;
  isStreaming: boolean;
}

const ToolCallSessionContext = createContext<null | ToolCallSessionValue>(null);

export function ToolCallSessionProvider({
  children,
  isAgentRunning,
  isStreaming,
}: {
  children: ReactNode;
  isAgentRunning: boolean;
  isStreaming: boolean;
}) {
  return (
    <ToolCallSessionContext.Provider value={{ isAgentRunning, isStreaming }}>
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
