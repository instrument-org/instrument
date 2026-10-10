import type { ComponentType } from "react";

import { providerMetadataAtom } from "@/client/atoms/provider-metadata";
import { BrandIconGlyph } from "@/client/components/brand-icon";
import { VendorMark } from "@/client/components/vendor-mark";
import { Cerebras } from "@/client/components/icons/cerebras";
import { DeepInfra } from "@/client/components/icons/deepinfra";
import { DeepSeek } from "@/client/components/icons/deepseek";
import { Fireworks } from "@/client/components/icons/fireworks";
import { Groq } from "@/client/components/icons/groq";
import { HuggingFace } from "@/client/components/icons/huggingface";
import { Jan } from "@/client/components/icons/jan";
import { LMStudio } from "@/client/components/icons/lmstudio";
import { LocalAI } from "@/client/components/icons/localai";
import { Minimax } from "@/client/components/icons/minimax";
import { Mistral } from "@/client/components/icons/mistral";
import { Novita } from "@/client/components/icons/novita";
import { OpenCode } from "@/client/components/icons/opencode";
import { Together } from "@/client/components/icons/together";
import { XAI } from "@/client/components/icons/x-ai";
import { ZAI } from "@/client/components/icons/z-ai";
import { OpenRouter } from "@/client/components/service-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import { type AIProviderType, OUR_MODELS } from "@instrument-org/shared";
import cerebrasColor from "@lobehub/icons-static-svg/icons/cerebras-color.svg?raw";
import claudeColor from "@lobehub/icons-static-svg/icons/claude-color.svg?raw";
import claude from "@lobehub/icons-static-svg/icons/claude.svg?raw";
import deepinfraColor from "@lobehub/icons-static-svg/icons/deepinfra-color.svg?raw";
import deepseekColor from "@lobehub/icons-static-svg/icons/deepseek-color.svg?raw";
import fireworksColor from "@lobehub/icons-static-svg/icons/fireworks-color.svg?raw";
import geminiColor from "@lobehub/icons-static-svg/icons/gemini-color.svg?raw";
import huggingfaceColor from "@lobehub/icons-static-svg/icons/huggingface-color.svg?raw";
import minimaxColor from "@lobehub/icons-static-svg/icons/minimax-color.svg?raw";
import mistralColor from "@lobehub/icons-static-svg/icons/mistral-color.svg?raw";
import novitaColor from "@lobehub/icons-static-svg/icons/novita-color.svg?raw";
import openrouterColor from "@lobehub/icons-static-svg/icons/openrouter-color.svg?raw";
import togetherColor from "@lobehub/icons-static-svg/icons/together-color.svg?raw";
import zhipuColor from "@lobehub/icons-static-svg/icons/zhipu-color.svg?raw";
import { useAtomValue } from "jotai";
import { GrNodes } from "react-icons/gr";
import {
  SiAnthropic,
  SiGooglegemini,
  SiOllama,
  SiOpenai,
  SiVercel,
} from "react-icons/si";

/**
 * The glyph cropped to what it draws. Its own box leaves a quarter of itself
 * empty around the mark, which beside other providers' marks, drawn edge to
 * edge, made Instrument read a size smaller in every list of providers.
 */
function InstrumentProviderGlyph({ className }: { className?: string }) {
  return <BrandIconGlyph className={className} viewBox="71 71 380 380" />;
}

/**
 * Claude's own mark, one color, for a Claude account, and for Anthropic
 * everywhere but the moment a provider is chosen by its API key, where the
 * company's mark is the one on the key's page.
 */
function ClaudeMark({ className }: { className?: string }) {
  return <VendorMark className={className} svg={claude} />;
}

/**
 * The providers whose mark has a version in its own colors. The rest are
 * drawn in one color either way, which for OpenAI and xAI is their mark.
 */
const PROVIDER_COLOR_SVG: Partial<Record<AIProviderType, string>> = {
  anthropic: claudeColor,
  cerebras: cerebrasColor,
  "claude-account": claudeColor,
  deepinfra: deepinfraColor,
  deepseek: deepseekColor,
  fireworks: fireworksColor,
  google: geminiColor,
  huggingface: huggingfaceColor,
  minimax: minimaxColor,
  mistral: mistralColor,
  novita: novitaColor,
  openrouter: openrouterColor,
  together: togetherColor,
  "z-ai": zhipuColor,
};

const PROVIDER_ICON_MAP: Record<
  AIProviderType,
  ComponentType<{ className?: string }> | null
> = {
  anthropic: ClaudeMark,
  cerebras: Cerebras,
  "chatgpt-account": SiOpenai,
  "claude-account": ClaudeMark,
  deepinfra: DeepInfra,
  deepseek: DeepSeek,
  fireworks: Fireworks,
  google: SiGooglegemini,
  groq: Groq,
  huggingface: HuggingFace,
  jan: Jan,
  lmstudio: LMStudio,
  localai: LocalAI,
  minimax: Minimax,
  mistral: Mistral,
  novita: Novita,
  ollama: SiOllama,
  openai: SiOpenai,
  "openai-compatible": GrNodes,
  "opencode-go": OpenCode,
  "opencode-zen": OpenCode,
  openrouter: OpenRouter,
  [OUR_MODELS.providerType]: InstrumentProviderGlyph,
  together: Together,
  vercel: SiVercel,
  "x-ai": XAI,
  "z-ai": ZAI,
};

export function AIProviderIcon({
  className = "size-5",
  colored = false,
  company = false,
  displayName,
  showTooltip = false,
  type,
}: {
  className?: string;
  /** The mark in its brand's colors where it has them, and Instrument's in green. */
  colored?: boolean;
  /** The company's mark rather than its product's (Anthropic rather than Claude), for choosing a provider by its API key. */
  company?: boolean;
  displayName?: string;
  showTooltip?: boolean;
  type: AIProviderType;
}) {
  const colorSvg = colored ? PROVIDER_COLOR_SVG[type] : undefined;
  const Icon = PROVIDER_ICON_MAP[type] ?? GrNodes;
  const markClass =
    colored && type === OUR_MODELS.providerType
      ? cn("text-brand-600 dark:text-brand-400", className)
      : className;
  const icon =
    company && type === "anthropic" ? (
      <SiAnthropic className={markClass} />
    ) : colorSvg === undefined ? (
      <Icon className={markClass} />
    ) : (
      <VendorMark className={markClass} svg={colorSvg} />
    );
  const { providerMetadataMap } = useAtomValue(providerMetadataAtom);
  const metadata = providerMetadataMap.get(type);

  if (showTooltip && metadata) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="shrink-0">{icon}</div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{displayName ?? metadata.name}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return icon;
}
