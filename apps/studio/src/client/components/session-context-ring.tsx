import { formatNumber } from "@/client/lib/format-number";
import { rpcClient } from "@/client/rpc/client";
import { type AIGatewayModel } from "@instrument-org/ai-gateway/client";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const DEFAULT_CONTEXT_WINDOW = 200_000;

// Fallback context windows (in tokens) keyed by canonicalId prefix, matched
// longest-first, for the providers that never report one. Only OpenRouter-shaped
// responses (which covers our own gateway) and Google carry a length, so a
// direct Anthropic, OpenAI, or OpenAI-compatible key lands here. Gemini is
// absent on purpose: Google always answers with `inputTokenLimit`, so an entry
// for it could only ever go stale unread.
const MODEL_CONTEXT_WINDOW_PREFIXES: [string, number][] = [
  // Inception
  ["mercury", 128_000],
  // Anthropic — haiku and sonnet <4 are 200k; sonnet 4+, opus 4.6+, and fable are 1M
  ["claude-haiku", 200_000],
  ["claude-sonnet-4", 1_000_000],
  ["claude-sonnet-5", 1_000_000],
  ["claude-sonnet", 200_000],
  ["claude-opus-4.6", 1_000_000],
  ["claude-opus-4.7", 1_000_000],
  ["claude-opus-4.8", 1_000_000],
  ["claude-opus-5", 1_000_000],
  ["claude-opus", 200_000],
  ["claude-fable", 1_000_000],
  // OpenAI — chat/nano variants are 128k; GPT-5 through 5.3 are 400k, 5.4+ are 1.05M
  ["gpt-5", 400_000],
  ["gpt-5.4", 1_050_000],
  ["gpt-5.5", 1_050_000],
  ["gpt-5.6", 1_050_000],
  // xAI — 4.3 and the 4.20 line are wide; 4.5+ traded width for speed
  ["grok-4.3", 1_000_000],
  ["grok-4.20", 2_000_000],
  ["grok-4.5", 500_000],
  ["grok-4.6", 500_000],
  ["grok-build", 256_000],
  // Moonshot / Kimi
  ["kimi-k2", 262_000],
  ["kimi-k3", 1_048_576],
  // Qwen — the numbered releases from 3.7 on are 1M; the older coder line is 262k
  ["qwen3-coder-plus", 128_000],
  ["qwen3-coder", 262_000],
  ["qwen3-max", 256_000],
  ["qwen-3-coder", 262_000],
  ["qwen3.7", 1_000_000],
  ["qwen3.8", 1_000_000],
  // Mistral
  ["devstral", 262_144],
  // MiniMax
  ["minimax-m1", 1_000_000],
  ["minimax-m2", 196_000],
  ["minimax-m3", 1_048_576],
  // ZhipuAI / GLM (4.5–4.7 range ~128–202k; use 200k as reasonable default)
  ["glm-4", 200_000],
  ["glm-5", 204_800],
  ["glm-5.2", 1_048_576],
  ["glm-5.3", 1_310_720],
];

// The provider's own answer wherever there is one, so that a model released
// after this build still reads its real window. The table below only stands in
// where the provider stayed silent, and `estimated` is how the tooltip says so
// rather than presenting a guess as the model's stated limit.
function getContextWindowForModel(model?: AIGatewayModel.Type): {
  estimated: boolean;
  tokens: number;
} {
  if (model?.contextLength !== undefined) {
    return { estimated: false, tokens: model.contextLength };
  }

  const sorted = [...MODEL_CONTEXT_WINDOW_PREFIXES].sort(
    ([a], [b]) => b.length - a.length,
  );
  const match = model
    ? sorted.find(([prefix]) => model.canonicalId.startsWith(prefix))
    : undefined;
  return { estimated: true, tokens: match?.[1] ?? DEFAULT_CONTEXT_WINDOW };
}

// Models tend to underperform past ~200k tokens of context, so we cap the ring
// at this threshold regardless of the model's actual maximum. The tooltip still
// shows the true context size so users know the model's real limit.
const RING_CAP = 200_000;
const SIZE = 20;
const CENTER = SIZE / 2;
const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function SessionContextRing({
  id,
  model,
  selectedSessionId,
}: {
  id: TaskId;
  model?: AIGatewayModel.Type;
  selectedSessionId: StoreId.Session;
}) {
  const { data } = useQuery(
    rpcClient.workspace.session.live.contextTokens.experimental_liveOptions({
      input: { id, sessionId: selectedSessionId },
    }),
  );

  const tokens = data?.inputTokens ?? 0;

  const { estimated, tokens: contextWindow } = getContextWindowForModel(model);

  if (tokens === 0) {
    return null;
  }

  const ratio = Math.min(tokens / Math.min(contextWindow, RING_CAP), 1);
  const dashOffset = CIRCUMFERENCE * (1 - ratio);

  const percentUsed = Math.round(ratio * 100);

  let strokeColor = "text-foreground/30";
  if (ratio >= 0.9) {
    strokeColor = "text-destructive";
  } else if (ratio >= 0.7) {
    strokeColor = "text-foreground/70";
  }

  return (
    <Tooltip>
      <TooltipTrigger className="flex size-8 items-center justify-center">
        <svg
          className={strokeColor}
          fill="none"
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
        >
          <circle
            className="opacity-20"
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            stroke="currentColor"
            strokeWidth={2.5}
          />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            stroke="currentColor"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            strokeWidth={2.5}
            style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
          />
        </svg>
      </TooltipTrigger>
      <TooltipContent align="end" className="p-3 text-xs" side="top">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-6">
            <span className="opacity-80">Tokens used:</span>
            <span className="font-medium tabular-nums">
              {formatNumber(tokens)} / {formatNumber(contextWindow)}
            </span>
          </div>
          {contextWindow > RING_CAP && (
            <div className="flex items-baseline justify-between gap-6">
              <span className="opacity-80">Effective limit:</span>
              <span className="font-medium tabular-nums">
                {formatNumber(RING_CAP)} ({percentUsed}%)
              </span>
            </div>
          )}
          {contextWindow <= RING_CAP && (
            <div className="flex items-baseline justify-between gap-6">
              <span className="opacity-80">Usage:</span>
              <span className="font-medium tabular-nums">{percentUsed}%</span>
            </div>
          )}
          {estimated && (
            <div className="max-w-52 opacity-60">
              This provider does not report a window size, so this is an
              estimate.
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
