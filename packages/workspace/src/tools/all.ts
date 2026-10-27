import { type InferUITools } from "ai";

import type { AnyAgentTool, ToolName } from "./types";

import { AskPermission } from "./ask-permission";
import { BashTool } from "./bash";
import { Choose } from "./choose";
import { ConnectApp } from "./connect-app";
import { EditFile } from "./edit-file";
import { GenerateImage } from "./generate-image";
import { LoadSkill } from "./load-skill";
import { OfferFeedback } from "./offer-feedback";
import { ReadFile } from "./read-file";
import { Unavailable } from "./unavailable";
import { WebFetch } from "./web-fetch";
import { WebSearch } from "./web-search";
import { WriteFile } from "./write-file";

export const TOOLS = {
  AskPermission,
  BashTool,
  Choose,
  ConnectApp,
  EditFile,
  GenerateImage,
  LoadSkill,
  OfferFeedback,
  ReadFile,
  Unavailable,
  WebFetch,
  WebSearch,
  WriteFile,
};

export type InternalToolName = keyof typeof TOOLS;

export const TOOLS_BY_NAME = {
  [TOOLS.AskPermission.name]: TOOLS.AskPermission,
  [TOOLS.BashTool.name]: TOOLS.BashTool,
  [TOOLS.Choose.name]: TOOLS.Choose,
  [TOOLS.ConnectApp.name]: TOOLS.ConnectApp,
  [TOOLS.EditFile.name]: TOOLS.EditFile,
  [TOOLS.GenerateImage.name]: TOOLS.GenerateImage,
  [TOOLS.LoadSkill.name]: TOOLS.LoadSkill,
  [TOOLS.OfferFeedback.name]: TOOLS.OfferFeedback,
  [TOOLS.ReadFile.name]: TOOLS.ReadFile,
  [TOOLS.Unavailable.name]: TOOLS.Unavailable,
  [TOOLS.WebFetch.name]: TOOLS.WebFetch,
  [TOOLS.WebSearch.name]: TOOLS.WebSearch,
  [TOOLS.WriteFile.name]: TOOLS.WriteFile,
  // `satisfies` ensures all tool names are present
} as const satisfies Record<ToolName, AnyAgentTool>;

export const TOOLS_FOR_MODEL_OUTPUT = Object.fromEntries(
  Object.values(TOOLS_BY_NAME).map((tool) => [
    tool.name,
    tool.staticAISDKTool(),
  ]),
);

export type AISDKTools = InferUITools<{
  [K in keyof typeof TOOLS_BY_NAME]: ReturnType<
    (typeof TOOLS_BY_NAME)[K]["staticAISDKTool"]
  >;
}>;

export function getToolByType<T extends ToolName>(
  type: `tool-${T}`,
): (typeof TOOLS_BY_NAME)[T] {
  const toolName = type.replace("tool-", "") as T;
  return TOOLS_BY_NAME[toolName];
}
