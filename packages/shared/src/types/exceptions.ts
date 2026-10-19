export type CaptureExceptionFunction = (
  error: unknown,
  // A grab bag for now, but could be per type in the future
  additionalProperties?: {
    apps_server_port?: number;
    assistant_error_kind?: string;
    // The code a failed sign-in's page shows, so a support message can be
    // matched to this report.
    auth_reference?: string;
    existing_part_state?: string;
    input_stream_char_count?: number;
    machine_name?: string;
    machine_state?: string;
    message_id?: string;
    modelId?: string;
    // The process event that delivered an error nothing else caught.
    origin?: "uncaughtException" | "unhandledRejection";
    part_has_input?: boolean;
    part_id?: string;
    provider_executed?: boolean;
    providerId?: string;
    rpc_path?: readonly string[];
    scopes?: ExceptionScope[];
    session_id?: string;
    tool_call_id?: string;
    tool_name?: string;
    tool_type?: string;
    unhandled_event?: string;
  },
) => void;

export type ExceptionScope =
  | "ai-gateway"
  | "api"
  | "auth"
  | "llm-request"
  | "rpc"
  | "studio"
  | "workspace";

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
