import { cn } from "@/client/lib/utils";
import arcee from "@lobehub/icons-static-svg/icons/arcee-color.svg";
import aws from "@lobehub/icons-static-svg/icons/aws-color.svg";
import bytedance from "@lobehub/icons-static-svg/icons/bytedance-color.svg";
import claude from "@lobehub/icons-static-svg/icons/claude-color.svg";
import cohere from "@lobehub/icons-static-svg/icons/cohere-color.svg";
import deepseek from "@lobehub/icons-static-svg/icons/deepseek-color.svg";
import gemini from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import hunyuan from "@lobehub/icons-static-svg/icons/hunyuan-color.svg";
import ibm from "@lobehub/icons-static-svg/icons/ibm.svg";
import kimi from "@lobehub/icons-static-svg/icons/kimi-color.svg";
import kwaipilot from "@lobehub/icons-static-svg/icons/kwaipilot-color.svg";
import meta from "@lobehub/icons-static-svg/icons/meta-color.svg";
import minimax from "@lobehub/icons-static-svg/icons/minimax-color.svg";
import mistral from "@lobehub/icons-static-svg/icons/mistral-color.svg";
import nvidia from "@lobehub/icons-static-svg/icons/nvidia-color.svg";
import openai from "@lobehub/icons-static-svg/icons/openai.svg";
import perplexity from "@lobehub/icons-static-svg/icons/perplexity-color.svg";
import poolside from "@lobehub/icons-static-svg/icons/poolside-color.svg";
import qwen from "@lobehub/icons-static-svg/icons/qwen-color.svg";
import sakana from "@lobehub/icons-static-svg/icons/sakana-color.svg";
import stepfun from "@lobehub/icons-static-svg/icons/stepfun-color.svg";
import upstage from "@lobehub/icons-static-svg/icons/upstage-color.svg";
import xai from "@lobehub/icons-static-svg/icons/xai.svg";
import xiaomi from "@lobehub/icons-static-svg/icons/xiaomimimo.svg";
import zhipu from "@lobehub/icons-static-svg/icons/zhipu-color.svg";

import { AIProviderIcon } from "./ai-provider-icon";

/**
 * Each maker's mark in its own colors, keyed by the author slug catalogs use,
 * so a list that mixes makers can be read by color before the names are. The
 * mark is the model line's where the maker ships one name for its models
 * (Claude, Gemini, Kimi), since that is what the row says. `mono` marks come
 * in one color only and are inverted on dark grounds.
 */
const MAKERS: Record<string, { mono?: true; src: string }> = {
  amazon: { src: aws },
  anthropic: { src: claude },
  "arcee-ai": { src: arcee },
  "bytedance-seed": { src: bytedance },
  cohere: { src: cohere },
  deepseek: { src: deepseek },
  "deepseek-ai": { src: deepseek },
  google: { src: gemini },
  "ibm-granite": { mono: true, src: ibm },
  kwaipilot: { src: kwaipilot },
  meta: { src: meta },
  "meta-llama": { src: meta },
  minimax: { src: minimax },
  mistralai: { src: mistral },
  moonshotai: { src: kimi },
  nvidia: { src: nvidia },
  openai: { mono: true, src: openai },
  perplexity: { src: perplexity },
  poolside: { src: poolside },
  qwen: { src: qwen },
  sakana: { src: sakana },
  stepfun: { src: stepfun },
  tencent: { src: hunyuan },
  upstage: { src: upstage },
  "x-ai": { mono: true, src: xai },
  xiaomi: { mono: true, src: xiaomi },
  "z-ai": { src: zhipu },
  "zai-org": { src: zhipu },
};

/** Whose model it is, in color where the maker has a mark, else a neutral glyph. */
export function ModelMakerIcon({
  author,
  className = "size-4",
}: {
  author: string;
  className?: string;
}) {
  const maker = MAKERS[author];
  if (!maker) {
    return (
      <AIProviderIcon
        className={cn("text-muted-foreground", className)}
        type="openai-compatible"
      />
    );
  }
  return (
    <img
      alt=""
      className={cn("shrink-0", maker.mono && "dark:invert", className)}
      draggable={false}
      src={maker.src}
    />
  );
}
