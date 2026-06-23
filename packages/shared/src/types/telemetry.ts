import { type AIProviderType } from "../schemas/ai-gateway";

export interface AnalyticsEvents {
  // Using snake_case for property names because they show with spaces in the UI
  // Using [noun].[past-tense-verb] for event names as is industry standard
  "app.manual_check_for_updates": never;
  "app.opened_in": {
    app_id: string;
  };
  "app.quit": never;
  "app.ready": {
    graceful_exit: boolean;
  };
  "app.sidebar_closed": never;
  "app.sidebar_opened": never;
  "auth.logged_in": never;
  "auth.logged_out": never;
  "auth.login_started": never;
  "command_menu.opened": never;
  "eval.created": {
    eval_names: string[];
    model_ids: string[];
  };
  "external_link.clicked": {
    external_url: string;
  };
  "favorite.added": never;
  "favorite.removed": never;
  "framework.not_supported": {
    framework: string;
  };
  "llm.error": WithModelProperties<LLMAnalyticsError>;
  "llm.reasoning_details_redacted": WithModelProperties<{
    redacted_message_count: number;
    redacted_reasoning_details_count: number;
    source_model_ids: string[];
    source_provider_ids: string[];
  }>;
  "llm.request_finished": WithModelProperties<{
    cached_input_tokens?: number | undefined;
    completion_tokens_per_second?: number | undefined;
    finish_reason: string;
    input_tokens: number | undefined;
    ms_to_finish: number;
    ms_to_first_chunk: number;
    output_tokens: number | undefined;
    reasoning_tokens?: number | undefined;
    step_count: number;
    total_tokens: number | undefined;
  }>;
  "llm.tool_called": WithModelProperties<{
    tool_name: string;
  }>;
  "llm.tool_executed": WithModelProperties<{
    success: boolean;
    tool_name: string;
  }>;
  "message.created": WithModelProperties<{
    files_count: number;
  }>;
  "model_picker.model_selected": WithModelProperties;
  "model_picker.opened": never;
  "model_picker.searched": {
    had_results: boolean;
    query: string;
  };
  "provider.created": {
    provider_type: AIProviderType;
  };
  "provider.picker_opened": never;
  "provider.removed": {
    provider_type: AIProviderType;
  };
  "provider.selected": {
    provider_type: AIProviderType;
  };
  "provider.verification_failed": {
    provider_type: AIProviderType;
  };
  "session.created": never;
  "session.removed": never;
  "session.replay_started": never;
  "session.stopped": never;
  "subscribe.billing_cycle_changed": {
    billing_cycle: "monthly" | "yearly";
  };
  "subscribe.contact_us_clicked": never;
  "subscribe.subscribe_clicked": {
    billing_cycle: "monthly" | "yearly";
    plan_name: string;
  };
  "task.bulk_deleted": {
    task_count: number;
  };
  "task.bulk_stopped": {
    task_count: number;
  };
  "task.created": WithModelProperties<{
    eval_name?: string;
    files_count: number;
  }>;
  "task.forked": never;
  "task.imported": never;
  "task.opened_in": {
    app_name: string;
  };
  "task.restored_version": never;
  "task.share_menu_opened": never;
  "task.shared": {
    share_type: "copied_screenshot" | "exported_zip" | "saved_screenshot";
  };
  "task.trashed": never;
  "task.updated": never;
  "upgrade.clicked": {
    source: "nav_user" | "toolbar";
  };
  "workspace.non_default_port": {
    apps_server_port: number;
  };
}

export type CaptureEventFunction<E = AnalyticsEvents> = <T extends keyof E>(
  type: T,

  ...rest: [E[T]] extends [never] ? [] : [properties: E[T]]
) => void;

export type CaptureExceptionFunction = (
  error: unknown,
  // A grab bag for now, but could be per type in the future
  additionalProperties?: {
    apps_server_port?: number;
    assistant_error_kind?: string;
    existing_part_state?: string;
    input_stream_char_count?: number;
    machine_name?: string;
    machine_state?: string;
    message_id?: string;
    modelId?: string;
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

type LLMAnalyticsError =
  | {
      error_message: string;
      error_type: "tool-error";
      tool_name: string;
    }
  | {
      error_type: "aborted";
    }
  | {
      error_type: "api-call";
    }
  | {
      error_type: "api-key";
    }
  | {
      error_type: "invalid-tool-input";
    }
  | {
      error_type: "no-such-tool";
      tool_name: string;
    };

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type WithModelProperties<T extends Record<string, unknown> = {}> = T & {
  modelId: string;
  providerId: string;
};
