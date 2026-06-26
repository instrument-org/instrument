import { createContext, type ReactNode, useContext } from "react";

interface ToolCallSessionValue {
  isAgentRunning: boolean;
  isCurrentTool: boolean;
  isStreaming: boolean;
}

const ToolCallSessionContext = createContext<null | ToolCallSessionValue>(null);

export function ToolCallSessionProvider({
  children,
  isAgentRunning,
  isCurrentTool,
  isStreaming,
}: {
  children: ReactNode;
  isAgentRunning: boolean;
  isCurrentTool: boolean;
  isStreaming: boolean;
}) {
  return (
    <ToolCallSessionContext.Provider
      value={{ isAgentRunning, isCurrentTool, isStreaming }}
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
