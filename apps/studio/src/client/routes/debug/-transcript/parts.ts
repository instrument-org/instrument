import {
  type AIGatewayModel,
  type AIGatewayModelURI,
} from "@instrument-org/ai-gateway/client";
import {
  AIProviderConfigIdSchema,
  OUR_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import {
  AbsolutePathSchema,
  MountedFolder,
  ProjectIdSchema,
  RelativePathSchema,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";

import { type TurnError } from "./script";

/**
 * The pieces of a message that are neither a tool call nor something said.
 *
 * Every path, id and model here goes through the schema that brands it, so a
 * fixture naming a path shape the app no longer accepts fails where it is
 * written rather than drawing a row nobody notices is wrong.
 */

// A fixed stamp, so a scenario reads the same every time it is built.
const AT = 1_718_198_400_000;

/** The model a platform error is about: ours, since only ours reports them. */
export const OUR_MODEL: AIGatewayModel.Type = {
  author: "anthropic",
  canonicalId: "claude-sonnet-5" as AIGatewayModel.CanonicalId,
  features: ["inputText", "outputText", "tools"],
  name: "Claude Sonnet 5",
  params: {
    provider: OUR_PROVIDER_CONFIG.type,
    providerConfigId: OUR_PROVIDER_CONFIG.id,
  },
  providerId: "anthropic-sonnet-5" as AIGatewayModel.ProviderId,
  providerName: "Anthropic",
  tags: ["default"],
  uri: `anthropic/claude-sonnet-5?provider=${OUR_PROVIDER_CONFIG.type}&providerConfigId=${OUR_PROVIDER_CONFIG.id}` as AIGatewayModelURI.Type,
};

/** A model on the user's ChatGPT account, for the errors only that plan sends. */
export const CHATGPT_ACCOUNT_MODEL: AIGatewayModel.Type = {
  author: "openai",
  canonicalId: "gpt-5.6-sol" as AIGatewayModel.CanonicalId,
  features: ["inputText", "outputText", "tools"],
  name: "GPT-5.6 Sol",
  params: {
    provider: "chatgpt-account",
    providerConfigId: AIProviderConfigIdSchema.parse("chatgpt-account"),
  },
  providerId: "gpt-5.6-sol" as AIGatewayModel.ProviderId,
  providerName: "ChatGPT account",
  tags: [],
  uri: "openai/gpt-5.6-sol?provider=chatgpt-account&providerConfigId=chatgpt-account" as AIGatewayModelURI.Type,
};

/** A model on the user's Claude subscription, run through Claude Code. */
export const CLAUDE_ACCOUNT_MODEL: AIGatewayModel.Type = {
  author: "anthropic",
  canonicalId: "claude-sonnet-5-5" as AIGatewayModel.CanonicalId,
  features: ["inputText", "outputText", "tools"],
  name: "Sonnet",
  params: {
    provider: "claude-account",
    providerConfigId: AIProviderConfigIdSchema.parse("claude-account"),
  },
  providerId: "claude-sonnet-5-5" as AIGatewayModel.ProviderId,
  providerName: "Claude account",
  tags: [],
  uri: "anthropic/claude-sonnet-5-5?provider=claude-account&providerConfigId=claude-account" as AIGatewayModelURI.Type,
};

/** A file the turn touched, for the grid of what changed. */
export function file({
  filePath,
  mimeType = "text/plain",
  size = 1024,
}: {
  filePath: string;
  mimeType?: string;
  size?: number;
}): SessionMessageDataPart.FileAttachmentDataPart {
  return {
    filename: filePath.split("/").at(-1) ?? filePath,
    filePath: RelativePathSchema.parse(filePath),
    mimeType,
    modifiedAt: AT,
    size,
  };
}

/** A folder on the user's own disk, mounted into the task. */
export function folder({
  access,
  path,
}: {
  access: MountedFolder.Access;
  path: string;
}): MountedFolder.Type {
  const name = path.split("/").at(-1) ?? path;
  return MountedFolder.Schema.parse({
    access,
    createdAt: AT,
    id: name,
    // Mount names are qualified with an ancestor directory, so they never match
    // what the row displays.
    mountName: `workspace-${name}`,
    path: AbsolutePathSchema.parse(path),
    source: "user",
  });
}

/**
 * An error our own gateway reports, rather than one a provider raised.
 *
 * The code is carried in the response body and read back out of it, and only
 * for a turn that named one of our models, so the recovery a card offers -- top
 * up, switch to Auto -- depends on both halves being right.
 */
export function platformFailure({
  code,
  message,
  name,
  statusCode,
}: {
  code:
    | "insufficient-credits"
    | "model-not-allowed"
    | "model-not-found"
    | "no-model-requested";
  message: string;
  name: string;
  statusCode: number;
}): TurnError {
  return {
    kind: "api-call",
    message,
    name,
    responseBody: JSON.stringify({
      error: { code, message, retryable: false },
    }),
    statusCode,
    url: "https://example.com",
  };
}

/**
 * The project a task was started from, frozen onto its first message.
 *
 * Written out rather than minted, since a project id carries a timestamp and a
 * freshly minted one would make a scenario read differently every time it was
 * built.
 */
export const PROJECT_ID = ProjectIdSchema.parse(
  "prj_01H8XGJWBWBAQ4ZQ9NG0R8FZ0G",
);
