import { type AIGatewayModel } from "../../schemas/model";

/**
 * Model features from a model list's declared modalities.
 *
 * A PDF reaches the model as a `file` part, which a provider rejects unless it
 * accepts files or converts them on the way in. So `inputFile` comes from an
 * explicit `file` input modality, or from `providerParsesPdfs` for a provider
 * that turns a PDF into text for any model that reads text.
 */
export function modalityFeatures({
  inputModalities,
  outputModalities,
  providerParsesPdfs,
  toolSupport,
}: {
  inputModalities: string[];
  outputModalities: string[];
  providerParsesPdfs: boolean;
  toolSupport: boolean;
}) {
  const features: AIGatewayModel.ModelFeatures[] = [];

  const readsText = inputModalities.includes("text");
  if (readsText) {
    features.push("inputText");
  }
  if (inputModalities.includes("file") || (readsText && providerParsesPdfs)) {
    features.push("inputFile");
  }
  if (inputModalities.includes("audio")) {
    features.push("inputAudio");
  }
  if (inputModalities.includes("image")) {
    features.push("inputImage");
  }
  if (outputModalities.includes("text")) {
    features.push("outputText");
  }
  if (toolSupport) {
    features.push("tools");
  }

  return features;
}
