import type { ModelMessage } from "ai";

import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { dedent } from "radashi";

import { mapModelMessageParts } from "./model-message-parts";

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

/**
 * Replace media a model cannot read with a note saying so.
 *
 * Runs over every media slot the shared traversal knows about, which includes
 * the ones inside a tool result: an image the agent read is media the model was
 * never sent by the user, and a model without image input chokes on it just the
 * same.
 */
export function filterUnsupportedMedia({
  messages,
  model,
}: {
  messages: ModelMessage[];
  model: AIGatewayModel.Type;
}) {
  return mapModelMessageParts(messages, {
    media: ({ mediaType }) => {
      // Capability is declared per media type, so media that declares none
      // cannot be matched against it either way.
      const replacementText =
        mediaType === undefined
          ? null
          : maybeCreateReplacementText(mediaType, model);
      return replacementText
        ? { note: replacementText, state: "dropped" }
        : { state: "unchanged" };
    },
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

function maybeCreateReplacementText(
  mediaType: string,
  model: AIGatewayModel.Type,
): null | string {
  const mediaCategory = getMediaTypeCategory(mediaType);

  if (mediaCategory === "other") {
    return null;
  }

  if (!model.features.includes(MEDIA_FEATURE_MAP[mediaCategory])) {
    return createReplacementText(mediaCategory);
  }

  return null;
}
