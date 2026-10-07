import { APP_NAME } from "@instrument-org/shared";
import { renderWithProviders } from "@/tests/render";
import { OUR_MODELS } from "@instrument-org/shared";
import { type SessionMessage } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageError } from "./message-error";
import { TooltipProvider } from "./ui/tooltip";

type MessageErrorData = NonNullable<
  SessionMessage.Assistant["metadata"]["error"]
>;

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    auth: {
      live: {
        hasToken: {
          experimental_liveOptions: () => ({
            queryFn: () => Promise.resolve(false),
            queryKey: ["auth", "hasToken"],
          }),
        },
      },
    },
    gateway: {
      models: {
        live: {
          list: {
            experimental_liveOptions: () => ({
              queryFn: () => Promise.resolve({ models: [] }),
              queryKey: ["gateway", "models"],
            }),
          },
        },
      },
    },
    utils: {
      openExternalLink: {
        mutationOptions: (options: object) => ({
          mutationFn: () => Promise.resolve(),
          ...options,
        }),
      },
    },
  },
}));

// Recorded from a task that hit this. Every clause of it is the problem: it
// names an upstream model the user never chose, and it offers a remedy on a
// vendor dashboard the user has no account on.
const UPSTREAM_THROTTLE_TEXT =
  '{"code":429,"message":"openai/gpt-5.6-luna is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations","metadata":{"error_type":"rate_limit_exceeded"}}';

// The provider decides two separate things: whether a body reads as one of our
// own platform errors, and whose account the provider's message is about.
// `null` stands for a message that recorded no model at all, which must not be
// mistaken for the user's own key.
function messageWithError(error: MessageErrorData, provider: null | string) {
  return {
    id: "msg_test",
    metadata: {
      aiGatewayModel:
        provider === null
          ? undefined
          : { name: "Test Model", params: { provider } },
      createdAt: new Date(),
      error,
      sessionId: "ses_test",
    },
    role: "assistant",
  } as unknown as SessionMessage.Assistant;
}

function openDetails() {
  fireEvent.click(screen.getByRole("button", { name: /details/i }));
}

function renderError({
  error = {
    classification: "rate-limit",
    kind: "unknown",
    message: UPSTREAM_THROTTLE_TEXT,
  },
  isDeveloperMode = false,
  isLastMessage = true,
  provider = OUR_MODELS.providerType,
}: {
  error?: MessageErrorData;
  isDeveloperMode?: boolean;
  isLastMessage?: boolean;
  provider?: null | string;
}) {
  return renderWithProviders(
    <TooltipProvider>
      <MessageError
        isAgentRunning={false}
        isDeveloperMode={isDeveloperMode}
        isLastMessage={isLastMessage}
        message={messageWithError(error, provider)}
        onContinue={vi.fn()}
        onModelChange={vi.fn()}
        onRunAgain={vi.fn()}
      />
    </TooltipProvider>,
  );
}

describe("MessageError", () => {
  it("keeps the provider's own text out of the transcript", () => {
    const { container } = renderError({});

    expect(container.textContent).not.toContain("openrouter");
    expect(container.textContent).not.toContain("gpt-5.6-luna");
    expect(screen.getByText(/the model is busy right now/i)).not.toBeNull();
  });

  it("shows the provider's text under developer mode", () => {
    const { container } = renderError({ isDeveloperMode: true });
    openDetails();

    expect(container.textContent).toContain("openrouter.ai");
  });

  it("shows the provider's text on the user's own key", () => {
    // Their account, their limit: the provider's message names the tier and
    // the reset, and both are things they can go and fix.
    const { container } = renderError({
      error: {
        classification: "rate-limit",
        kind: "api-call",
        message: "Rate limit reached for gpt-5.2 in organization org-abc",
        name: "AI_APICallError",
        responseBody: JSON.stringify({
          error: {
            code: "rate_limit_exceeded",
            message:
              "Rate limit reached for gpt-5.2 in organization org-abc on tokens per min. Limit: 30000, Used: 30000. Please try again in 2s.",
          },
        }),
        statusCode: 429,
        url: "https://api.openai.com/v1/chat/completions",
      },
      provider: "openai",
    });
    // Behind Details, so the card leads with what to do about it.
    expect(container.textContent).not.toContain("Limit: 30000");
    openDetails();

    expect(container.textContent).toContain("Limit: 30000");
    expect(container.textContent).toContain("organization org-abc");
    // Ours still comes first, because it is the sentence that says what to do.
    expect(container.textContent).toContain("The model is busy right now");
  });

  it("treats a turn with no recorded provider as ours", () => {
    const { container } = renderError({ provider: null });

    expect(screen.queryByRole("button", { name: /details/i })).toBeNull();
    expect(container.textContent).not.toContain("openrouter");
  });

  it("offers a way forward on a throttle from our own gateway", () => {
    // This body parses as a platform error, which used to suppress the footer
    // and leave the card with no control on it at all.
    renderError({
      error: {
        classification: "rate-limit",
        kind: "api-call",
        message: "Too many requests. Please try again shortly.",
        name: "AI_APICallError",
        responseBody: JSON.stringify({
          error: {
            code: "rate-limit-exceeded",
            message: "Too many requests. Please try again shortly.",
            retryable: true,
          },
        }),
        statusCode: 429,
        url: "https://example.com/gateway/openrouter/v1/chat/completions",
      },
    });

    expect(screen.getByRole("button", { name: "Try again" })).not.toBeNull();
  });

  it("names ChatGPT when its plan's limit was reached", () => {
    renderError({
      error: {
        classification: "usage-limit",
        kind: "api-call",
        message:
          "The ChatGPT user has reached their Subscription Sharing usage limit.",
        name: "AI_APICallError",
        statusCode: 400,
        url: "http://localhost/ai-gateway/providers/chatgpt-plan/responses",
      },
      provider: "chatgpt",
    });

    expect(screen.getByText("ChatGPT usage limit reached")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Manage usage" })).not.toBeNull();
  });

  it("offers Instrument when the Claude account's limit was reached", async () => {
    renderError({
      error: {
        classification: "usage-limit",
        kind: "api-call",
        message: "You've hit your limit",
        name: "AI_APICallError",
        statusCode: 429,
        url: "claude-account://",
      },
      provider: "claude-account",
    });

    expect(screen.getByText("Claude usage limit reached")).not.toBeNull();
    expect(
      await screen.findByRole("button", { name: `Try ${APP_NAME}` }),
    ).not.toBeNull();
  });

  it("says nothing about a throttle the session already got past", () => {
    const { container } = renderError({ isLastMessage: false });

    expect(container.innerHTML).toBe("");
  });
});
