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
