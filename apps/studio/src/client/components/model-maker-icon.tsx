import { VendorMark } from "@/client/components/vendor-mark";
import { cn } from "@/client/lib/utils";
import arcee from "@lobehub/icons-static-svg/icons/arcee-color.svg?raw";
import aws from "@lobehub/icons-static-svg/icons/aws-color.svg?raw";
import bytedance from "@lobehub/icons-static-svg/icons/bytedance-color.svg?raw";
import claude from "@lobehub/icons-static-svg/icons/claude-color.svg?raw";
import cohere from "@lobehub/icons-static-svg/icons/cohere-color.svg?raw";
import deepseek from "@lobehub/icons-static-svg/icons/deepseek-color.svg?raw";
import gemini from "@lobehub/icons-static-svg/icons/gemini-color.svg?raw";
import hunyuan from "@lobehub/icons-static-svg/icons/hunyuan-color.svg?raw";
import ibm from "@lobehub/icons-static-svg/icons/ibm.svg?raw";
import kimi from "@lobehub/icons-static-svg/icons/kimi-color.svg?raw";
import kwaipilot from "@lobehub/icons-static-svg/icons/kwaipilot-color.svg?raw";
import meta from "@lobehub/icons-static-svg/icons/meta-color.svg?raw";
import minimax from "@lobehub/icons-static-svg/icons/minimax-color.svg?raw";
import mistral from "@lobehub/icons-static-svg/icons/mistral-color.svg?raw";
import nvidia from "@lobehub/icons-static-svg/icons/nvidia-color.svg?raw";
import openai from "@lobehub/icons-static-svg/icons/openai.svg?raw";
import perplexity from "@lobehub/icons-static-svg/icons/perplexity-color.svg?raw";
import poolside from "@lobehub/icons-static-svg/icons/poolside-color.svg?raw";
import qwen from "@lobehub/icons-static-svg/icons/qwen-color.svg?raw";
import sakana from "@lobehub/icons-static-svg/icons/sakana-color.svg?raw";
import stepfun from "@lobehub/icons-static-svg/icons/stepfun-color.svg?raw";
import upstage from "@lobehub/icons-static-svg/icons/upstage-color.svg?raw";
import xai from "@lobehub/icons-static-svg/icons/xai.svg?raw";
import xiaomi from "@lobehub/icons-static-svg/icons/xiaomimimo.svg?raw";
import zhipu from "@lobehub/icons-static-svg/icons/zhipu-color.svg?raw";

import { AIProviderIcon } from "./ai-provider-icon";

/**
 * Each maker's mark in its own colors, keyed by the author slug catalogs use,
 * so a list that mixes makers can be read by color before the names are. The
 * mark is the model line's where the maker ships one name for its models
 * (Claude, Gemini, Kimi), since that is what the row says.
 */
const MAKERS: Record<string, { src: string }> = {
  amazon: { src: aws },
  anthropic: { src: claude },
  "arcee-ai": { src: arcee },
  "bytedance-seed": { src: bytedance },
  cohere: { src: cohere },
  deepseek: { src: deepseek },
  "deepseek-ai": { src: deepseek },
  google: { src: gemini },
  "ibm-granite": { src: ibm },
  kwaipilot: { src: kwaipilot },
  meta: { src: meta },
  "meta-llama": { src: meta },
  minimax: { src: minimax },
  mistralai: { src: mistral },
  moonshotai: { src: kimi },
  nvidia: { src: nvidia },
  openai: { src: openai },
  perplexity: { src: perplexity },
  poolside: { src: poolside },
  qwen: { src: qwen },
  sakana: { src: sakana },
  stepfun: { src: stepfun },
  tencent: { src: hunyuan },
  upstage: { src: upstage },
  "x-ai": { src: xai },
  xiaomi: { src: xiaomi },
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
    <VendorMark className={cn("text-foreground", className)} svg={maker.src} />
  );
}
