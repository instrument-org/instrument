import { createContext, useContext, type ReactNode } from "react";

type ToolCallSessionValue = {
  isAgentRunning: boolean;
  isStreaming: boolean;
};

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
    <ToolCallSessionContext.Provider
      value={{ isAgentRunning, isStreaming }}
    >
      {children}
    </ToolCallSessionContext.Provider>
  );
}

export function useToolCallSession(): ToolCallSessionValue {
  const value = useContext(ToolCallSessionContext);
  if (!value) {
    throw new Error(
      "useToolCallSession must be used within ToolCallSessionProvider",
    );
  }
  return value;
}
