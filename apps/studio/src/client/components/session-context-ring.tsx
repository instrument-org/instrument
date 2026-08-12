import { formatNumber } from "@/client/lib/format-number";
import { rpcClient } from "@/client/rpc/client";
import { type AIGatewayModel } from "@instrument-org/ai-gateway/client";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const DEFAULT_CONTEXT_WINDOW = 200_000;

// Context windows (in tokens) keyed by canonicalId prefix, matched longest-first.
// Models with no matching prefix fall back to DEFAULT_CONTEXT_WINDOW.
const MODEL_CONTEXT_WINDOW_PREFIXES: [string, number][] = [
  // Inception
  ["mercury", 128_000],
  // Anthropic — haiku/sonnet <4 and opus <4.6 are 200k; sonnet 4+ and opus 4.6+ are 1M
  ["claude-haiku", 200_000],
  ["claude-sonnet-4", 1_000_000],
  ["claude-sonnet", 200_000],
  ["claude-opus-4.6", 1_000_000],
  ["claude-opus-4.7", 1_000_000],
  ["claude-opus", 200_000],
  // OpenAI GPT-5.x — chat/nano variants are 128k; others are 400k
  ["gpt-5", 400_000],
  // Google — gemini 2.5+ and 3+ are all 1M
  ["gemini-2.5", 1_000_000],
  ["gemini-3", 1_000_000],
  ["grok-4.3", 1_000_000],
  // Moonshot / Kimi
  ["kimi-k2", 131_000],
  // Qwen — coder-plus is 128k; coder base is 262k
  ["qwen3-coder-plus", 128_000],
  ["qwen3-coder", 262_000],
  ["qwen3-max", 256_000],
  ["qwen-3-coder", 262_000],
  // Mistral
  ["devstral", 131_000],
  // MiniMax
  ["minimax-m1", 1_000_000],
  ["minimax-m2", 196_000],
  // ZhipuAI / GLM (4.5–4.7 range ~128–202k; use 200k as reasonable default)
  ["glm-4", 200_000],
];

function getContextWindowForModel(canonicalId: string): number {
  const sorted = [...MODEL_CONTEXT_WINDOW_PREFIXES].sort(
    ([a], [b]) => b.length - a.length,
  );
  const match = sorted.find(([prefix]) => canonicalId.startsWith(prefix));
  return match?.[1] ?? DEFAULT_CONTEXT_WINDOW;
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

  const contextWindow = model
    ? getContextWindowForModel(model.canonicalId)
    : DEFAULT_CONTEXT_WINDOW;

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
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
