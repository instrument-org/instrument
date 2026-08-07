import {
  type AIGatewayModel,
  type AIGatewayModelURI,
} from "@instrument-org/ai-gateway/client";
import { OUR_PROVIDER_CONFIG } from "@instrument-org/shared";
import {
  type SessionMessage,
  type SessionMessagePart,
  StoreId,
} from "@instrument-org/workspace/client";

export interface PresetSessionData {
  messages: SessionMessage.WithParts[];
  name: string;
}

export class SessionBuilder {
  private baseTime: Date;
  private sessionId: StoreId.Session;
  private timeOffset = 0;
  private toolCallCounter = 0;

  constructor(baseTime = new Date()) {
    this.baseTime = baseTime;
    this.sessionId = StoreId.newSessionId();
  }

  assistantMessage(text: string): SessionMessage.AssistantWithParts {
    const messageId = StoreId.newMessageId();
    return {
      id: messageId,
      metadata: {
        createdAt: this.nextTime(),
        finishReason: "stop",
        modelId: "claude-sonnet-4.5",
        providerId: "anthropic",
        sessionId: this.sessionId,
      },
      parts: [this.textPart(text, messageId)],
      role: "assistant",
    };
  }

  getSessionId(): StoreId.Session {
    return this.sessionId;
  }

  nextTime(incrementMs = 500): Date {
    const time = new Date(this.baseTime.getTime() + this.timeOffset);
    this.timeOffset += incrementMs;
    return time;
  }

  nextToolCallId(): string {
    this.toolCallCounter++;
    // cspell:ignore toolu
    return `toolu_${this.toolCallCounter}`;
  }

  partMetadata(messageId: StoreId.Message): {
    createdAt: Date;
    id: StoreId.Part;
    messageId: StoreId.Message;
    sessionId: StoreId.Session;
  } {
    return {
      createdAt: this.nextTime(),
      id: StoreId.newPartId(),
      messageId,
      sessionId: this.sessionId,
    };
  }

  textPart(
    text: string,
    messageId: StoreId.Message,
  ): SessionMessagePart.TextPart {
    const metadata = this.partMetadata(messageId);
    return {
      metadata,
      state: "done",
      text,
      type: "text",
    };
  }

  /**
   * Every call a preset builds has started, and only a finished one has ended.
   * A call still waiting behind the ones ahead of it is a state a fixed
   * transcript cannot really hold still in; the playback page walks a call
   * through it instead.
   */
  toolPart<
    TState extends SessionMessagePart.ToolPart["state"],
    TPart extends SessionMessagePart.ToolPart & { state: TState },
  >(
    messageId: StoreId.Message,
    state: TState,
    partialPart: Omit<TPart, "metadata" | "state" | "toolCallId">,
  ): TPart {
    const hasEnded = state === "output-available" || state === "output-error";
    return {
      ...partialPart,
      metadata: {
        ...this.partMetadata(messageId),
        startedAt: this.nextTime(),
        ...(hasEnded ? { endedAt: this.nextTime() } : {}),
      },
      state,
      toolCallId: this.nextToolCallId(),
    } as TPart;
  }

  userMessage(
    text: string,
    options?: {
      parts?: Omit<SessionMessagePart.DataPart, "metadata">[];
    },
  ): SessionMessage.UserWithParts {
    const messageId = StoreId.newMessageId();
    const parts: SessionMessage.UserWithParts["parts"] = [];

    if (text) {
      parts.push(this.textPart(text, messageId));
    }

    if (options?.parts) {
      for (const part of options.parts) {
        parts.push({
          ...(part as SessionMessagePart.DataPart),
          metadata: this.partMetadata(messageId),
        });
      }
    }

    return {
      id: messageId,
      metadata: {
        createdAt: this.nextTime(),
        sessionId: this.sessionId,
      },
      parts,
      role: "user",
    };
  }
}

export function createDefaultAIGatewayModel(): AIGatewayModel.Type {
  return {
    author: "anthropic",
    canonicalId: "claude-sonnet-4.5" as AIGatewayModel.CanonicalId,
    features: ["inputText", "outputText", "tools"],
    name: "Claude 3.5 Sonnet",
    params: {
      provider: OUR_PROVIDER_CONFIG.type,
      providerConfigId: OUR_PROVIDER_CONFIG.id,
    },
    providerId: "anthropic-sonnet-4.5" as AIGatewayModel.ProviderId,
    providerName: "Anthropic",
    tags: ["default"],
    uri: `anthropic/claude-sonnet-4.5?provider=${OUR_PROVIDER_CONFIG.type}&providerConfigId=${OUR_PROVIDER_CONFIG.id}` as AIGatewayModelURI.Type,
  };
}

export function createErrorMessage({
  code,
  message,
  name,
  statusCode,
}: {
  code?: string;
  message: string;
  name: string;
  statusCode: number;
}): NonNullable<SessionMessage.AssistantWithParts["metadata"]["error"]> {
  return {
    kind: "api-call",
    message,
    name,
    responseBody: code
      ? JSON.stringify({
          error: {
            code,
            message,
            retryable: false,
          },
        })
      : undefined,
    statusCode,
    url: "https://example.com",
  };
}
