/**
 * What the code capturing an exception knows about it, beyond the error
 * itself. Every key is optional: a bare capture is complete, since the event
 * built from it carries the stack, the error's own properties, its causes,
 * and where the app was.
 */
export type CaptureContext = {
  /** Which part of the app it was in, where that is not the binding's own. */
  area?: string;
  chatId?: string;
  /** The React component stack an error boundary saw. */
  componentStack?: string;
  /** Anything else worth having beside it: copied, three levels deep. */
  data?: Record<string, unknown>;
  /** False for what only a global handler caught. Defaults to true. */
  handled?: boolean;
  /** `fatal` for a process that ended. Defaults to `error`. */
  level?: "error" | "fatal";
  /** How it was caught: `rpc`, `error-boundary`, `uncaughtException`, ... */
  mechanism?: string;
  messageId?: string;
  modelId?: string;
  providerId?: string;
  /** The RPC procedure that threw, dotted: `chats.send`. */
  rpcPath?: string;
  sessionId?: string;
  toolCallId?: string;
  toolName?: string;
};

export type CaptureExceptionFunction = (
  error: unknown,
  context?: CaptureContext,
) => void;
