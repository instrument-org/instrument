import { type AIGatewayModel } from "../../schemas/model";

export function modalityFeatures({
  inputModalities,
  outputModalities,
  toolSupport,
}: {
  inputModalities: string[];
  outputModalities: string[];
  toolSupport: boolean;
}) {
  const features: AIGatewayModel.ModelFeatures[] = [];

  if (inputModalities.includes("text")) {
    features.push("inputText", "inputFile");
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
