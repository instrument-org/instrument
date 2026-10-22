import { renderWithProviders } from "@/tests/render";
import { OUR_MODELS } from "@instrument-org/shared";
import { type SessionMessage } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../atoms/settings-modal", () => ({ openSettings: vi.fn() }));

const signInAgain = vi.hoisted(() => vi.fn());
vi.mock("../hooks/use-sign-in-again", () => ({
  useSignInAgain: () => ({
    cancel: vi.fn(),
    signIn: signInAgain,
    waiting: () => false,
  }),
}));

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
            queryFn: () => Promise.resolve(true),
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
              queryFn: () =>
                Promise.resolve({
                  models: [
                    {
                      uri: "auto?provider=instrument",
                      providerId: OUR_MODELS.text.id,
                      name: "Auto",
                    },
                  ],
                }),
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
  isAgentRunning = false,
  error = {
    classification: "rate-limit",
    kind: "unknown",
    message: UPSTREAM_THROTTLE_TEXT,
  },
  isDeveloperMode = false,
  isLastMessage = true,
  provider = OUR_MODELS.providerType,
  onModelChange = vi.fn(),
}: {
  error?: MessageErrorData;
  isAgentRunning?: boolean;
  isDeveloperMode?: boolean;
  isLastMessage?: boolean;
  provider?: null | string;
  onModelChange?: (uri: string) => void;
}) {
  return renderWithProviders(
    <TooltipProvider>
      <MessageError
        isAgentRunning={isAgentRunning}
        isDeveloperMode={isDeveloperMode}
        isLastMessage={isLastMessage}
        message={messageWithError(error, provider)}
        onModelChange={onModelChange}
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

  // The gateway's own sentence is written for its logs, so a refused model
  // reads as ours, naming the model the turn ran on.
  it.each([
    ["model-not-allowed", "Your plan doesn't include Test Model."],
    ["model-not-found", "Instrument doesn't offer Test Model anymore."],
    ["no-model-requested", "This chat doesn't have a model chosen."],
  ])("says what a %s refusal means", (code, sentence) => {
    const { container } = renderError({
      error: {
        kind: "api-call",
        message: "Forbidden",
        name: "AI_APICallError",
        responseBody: JSON.stringify({
          error: { code, message: "The requested model is not allowed." },
        }),
        statusCode: 403,
        url: "http://localhost/ai-gateway/providers/instrument/responses",
      },
    });

    expect(screen.getByText("Test Model isn't available")).not.toBeNull();
    expect(screen.getByText(sentence)).not.toBeNull();
    expect(container.textContent).not.toContain("requested model");
  });

  // The way forward is the note over the reply box (`PlanAccountNote`), so
  // the transcript keeps one plain line naming the plan.
  it.each([
    {
      error: {
        classification: "usage-limit",
        kind: "api-call",
        message:
          "The ChatGPT user has reached their Subscription Sharing usage limit.",
        name: "AI_APICallError",
        statusCode: 400,
        url: "http://localhost/ai-gateway/providers/chatgpt-account/responses",
      },
      line: "I had to stop here. Your ChatGPT plan is out of usage for now.",
      provider: "chatgpt-account",
    },
    {
      error: {
        classification: "usage-limit",
        kind: "api-call",
        message: "You've hit your limit",
        name: "AI_APICallError",
        statusCode: 429,
        url: "claude-account://",
      },
      line: "I had to stop here. Your Claude plan is out of usage for now.",
      provider: "claude-account",
    },
  ] satisfies {
    error: MessageErrorData;
    line: string;
    provider: string;
  }[])(
    "ends a turn $provider's plan stopped on one line",
    ({ error, line, provider }) => {
      renderError({ error, provider });

      expect(screen.getByText(line)).not.toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
    },
  );

  it("ends a Grok turn the account has no plan for on one line", () => {
    renderError({
      error: {
        classification: "auth",
        kind: "api-call",
        message: "refused",
        name: "AI_APICallError",
        statusCode: 429,
        url: "http://localhost/ai-gateway/providers/grok-1/responses",
      },
      provider: "grok-account",
    });

    expect(
      screen.getByText(
        "I couldn't start on this. Grok says this account doesn't have an eligible paid plan.",
      ),
    ).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("starts the account's own sign-in from a signed-out turn", () => {
    renderError({
      error: {
        classification: "auth",
        kind: "api-call",
        message: "refused",
        name: "AI_APICallError",
        statusCode: 401,
        url: "http://localhost/ai-gateway/providers/grok-1/responses",
      },
      provider: "grok-account",
    });

    expect(screen.getByText("Signed out of Grok")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(signInAgain).toHaveBeenCalledWith("grok-account", undefined);
  });

  it("never says signed out for a ChatGPT plan that can't be used here", () => {
    renderError({
      error: {
        classification: "auth",
        kind: "api-call",
        message: "refused",
        name: "AI_APICallError",
        responseBody: JSON.stringify({
          error: { code: "chatpass_v2_scope_not_authorized" },
        }),
        statusCode: 403,
        url: "http://localhost/ai-gateway/providers/chatgpt-1/responses",
      },
      provider: "chatgpt-account",
    });

    expect(screen.queryByText("Signed out of ChatGPT")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  it("says nothing about a throttle the session already got past", () => {
    const { container } = renderError({ isLastMessage: false });

    expect(container.innerHTML).toBe("");
  });

  describe("our platform's refusals for the plan", () => {
    const refusal = (body: object, statusCode: number): MessageErrorData => ({
      classification: "usage-limit",
      kind: "api-call",
      message: "Refused",
      name: "AI_APICallError",
      responseBody: JSON.stringify({ error: body }),
      statusCode,
      url: "http://localhost/gateway/openrouter/v1/chat/completions",
    });

    // The way forward is the notice over the reply box, so the transcript
    // keeps one plain line and no card, buttons, or retry.
    it.each([
      {
        body: { code: "subscription-required", reason: "trial-ended" },
        line: "Stopped: your free trial has ended.",
        statusCode: 402,
      },
      {
        body: { code: "usage-limit-exceeded", window: "5h" },
        line: "Stopped: you've reached your plan's limit for now.",
        statusCode: 429,
      },
    ])(
      "ends the turn on one line for $body.code",
      ({ body, line, statusCode }) => {
        renderError({ error: refusal(body, statusCode) });

        expect(screen.getByText(line)).not.toBeNull();
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.queryByRole("button")).toBeNull();
      },
    );

    it("keeps the line once the chat has moved on", () => {
      renderError({
        error: refusal(
          { code: "subscription-required", reason: "no-plan" },
          402,
        ),
        isLastMessage: false,
      });

      expect(
        screen.getByText("Stopped: Instrument needs a plan."),
      ).not.toBeNull();
    });

    it("waits rather than erring while too many tasks are running", () => {
      renderError({
        error: refusal({ code: "concurrency-limit" }, 429),
        isAgentRunning: true,
      });

      expect(
        screen.getByText("Waiting for one of your other tasks to finish"),
      ).not.toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("says nothing about a wait the turn got past", () => {
      const { container } = renderError({
        error: refusal({ code: "concurrency-limit" }, 429),
        isLastMessage: false,
      });

      expect(container.innerHTML).toBe("");
    });
  });
});
