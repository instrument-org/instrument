import type { ModelMessage } from "ai";

import {
  type AIGatewayModel,
  getProviderMetadata,
} from "@instrument-org/ai-gateway";
import { dedent } from "radashi";

type MediaCategory = "audio" | "file" | "image" | "video";

const MEDIA_LABELS: Record<MediaCategory, string> = {
  audio: "Audio",
  file: "File",
  image: "Image",
  video: "Video",
};

const MEDIA_FEATURE_MAP: Record<MediaCategory, AIGatewayModel.ModelFeatures> = {
  audio: "inputAudio",
  file: "inputFile",
  image: "inputImage",
  video: "inputVideo",
};

export function filterUnsupportedMedia({
  messages,
  model,
}: {
  messages: ModelMessage[];
  model: AIGatewayModel.Type;
}): ModelMessage[] {
  return messages.map((message) => {
    if (message.role === "user" && Array.isArray(message.content)) {
      message.content = message.content.map((part) => {
        if (
          typeof part === "object" &&
          "type" in part &&
          part.type === "file" &&
          "mediaType" in part &&
          typeof part.mediaType === "string"
        ) {
          const replacementText = maybeCreateReplacementText(
            part.mediaType,
            model,
          );
          if (replacementText) {
            return { text: replacementText, type: "text" };
          }
        }
        return part;
      });
    }

    if (message.role === "assistant" && Array.isArray(message.content)) {
      message.content = message.content.map((part) => {
        if (
          typeof part === "object" &&
          "type" in part &&
          part.type === "file" &&
          "mediaType" in part &&
          typeof part.mediaType === "string"
        ) {
          const replacementText = maybeCreateReplacementText(
            part.mediaType,
            model,
          );
          if (replacementText) {
            return { text: replacementText, type: "text" };
          }
        }
        return part;
      });
    }

    if (message.role === "tool" && Array.isArray(message.content)) {
      message.content = message.content.map((part) => {
        if (
          typeof part === "object" &&
          "output" in part &&
          typeof part.output === "object" &&
          "type" in part.output &&
          part.output.type === "content" &&
          "value" in part.output &&
          Array.isArray(part.output.value)
        ) {
          part.output.value = part.output.value.map((valuePart) => {
            // Workaround for the entire valuePart.type being marked as deprecated
            // due to the deprecation of type === "media"
            const narrowedPart = valuePart as Exclude<
              typeof valuePart,
              { type: "media" }
            >;

            if (
              typeof narrowedPart === "object" &&
              "type" in narrowedPart &&
              (narrowedPart.type === "image-data" ||
                narrowedPart.type === "file-data") &&
              "mediaType" in narrowedPart &&
              typeof narrowedPart.mediaType === "string"
            ) {
              const replacementText = maybeCreateReplacementText(
                narrowedPart.mediaType,
                model,
              );
              if (replacementText) {
                return { text: replacementText, type: "text" as const };
              }
            }

            return valuePart;
          });
        }

        return part;
      });
    }

    return message;
  });
}

function createReplacementText(mediaCategory: MediaCategory): string {
  return dedent`
    <system_note>
    ${MEDIA_LABELS[mediaCategory]} file removed - your model lacks ${mediaCategory} input capability.
    Convert it to a different format or request the user to provide it in a different format if you need to access it.
    </system_note>
  `;
}

function getMediaTypeCategory(mediaType: string): "other" | MediaCategory {
  if (mediaType.startsWith("audio/")) {
    return "audio";
  }
  if (mediaType.startsWith("image/")) {
    return "image";
  }
  if (mediaType.startsWith("video/")) {
    return "video";
  }
  if (mediaType === "application/pdf") {
    return "file";
  }
  return "other";
}

function isKnownBrokenCombo(
  mediaCategory: MediaCategory,
  model: AIGatewayModel.Type,
): boolean {
  const brokenMedia = getProviderMetadata(model.params.provider).quirks
    .brokenMedia;
  return brokenMedia.some(
    (entry) =>
      entry.category === mediaCategory && entry.author === model.author,
  );
}

function maybeCreateReplacementText(
  mediaType: string,
  model: AIGatewayModel.Type,
): null | string {
  const mediaCategory = getMediaTypeCategory(mediaType);

  if (mediaCategory === "other") {
    return null;
  }

  if (
    !model.features.includes(MEDIA_FEATURE_MAP[mediaCategory]) ||
    isKnownBrokenCombo(mediaCategory, model)
  ) {
    return createReplacementText(mediaCategory);
  }

  return null;
}
