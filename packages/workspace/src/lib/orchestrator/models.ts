import {
  type AIGatewayModel,
  fetchModelResultsForProviders,
} from "@instrument-org/ai-gateway";

import { getWorkspaceConfig } from "../workspace-config";

export type ModelColumn =
  | "context"
  | "name"
  | "price"
  | "provider"
  | "released"
  | "tags"
  | "takes"
  | "uri";

/**
 * Every model the orchestrator can hand a task, newest first. A restricted
 * model is one the signed-in user cannot run, so it is left out rather than
 * listed for a task that would fail on its first request. Models with no
 * release date sort after every dated one, and names break ties.
 */
export async function listRunnableModels(): Promise<AIGatewayModel.Type[]> {
  const workspaceConfig = getWorkspaceConfig();
  const results = await fetchModelResultsForProviders(
    workspaceConfig.getAIProviderConfigs(),
    {
      captureException: workspaceConfig.captureException,
      modelCache: workspaceConfig.modelCache,
    },
  );
  return results
    .flatMap((result) => (result.ok ? result.value : []))
    .filter((model) => model.restricted === undefined)
    .toSorted(
      (a, b) =>
        (b.releasedAt ?? "").localeCompare(a.releasedAt ?? "") ||
        a.name.localeCompare(b.name),
    );
}

export const ALL_MODEL_COLUMNS: ModelColumn[] = [
  "uri",
  "name",
  "provider",
  "released",
  "context",
  "price",
  "takes",
  "tags",
];

const HEADER: Record<ModelColumn, string> = {
  context: "context",
  name: "name",
  price: "$/M in/out",
  provider: "provider",
  released: "released",
  tags: "tags",
  takes: "takes",
  uri: "uri",
};

/** Models as an aligned text table, one row each, the last column ragged. */
export function modelTable(
  models: AIGatewayModel.Type[],
  columns: ModelColumn[] = ALL_MODEL_COLUMNS,
): string {
  return table(
    columns.map((column) => HEADER[column]),
    models.map((model) => columns.map((column) => cell(model, column))),
  );
}

function cell(model: AIGatewayModel.Type, column: ModelColumn): string {
  switch (column) {
    case "context": {
      return model.contextLength === undefined
        ? "?"
        : `${Math.round(model.contextLength / 1000)}K`;
    }
    case "name": {
      return model.name;
    }
    case "price": {
      return model.pricing
        ? `${dollars(model.pricing.input)}/${dollars(model.pricing.output)}`
        : "?";
    }
    case "provider": {
      return model.providerName;
    }
    case "released": {
      return model.releasedAt ?? "?";
    }
    case "tags": {
      return model.tags.join(",") || "-";
    }
    case "takes": {
      return abilities(model).join(",") || "-";
    }
    case "uri": {
      return model.uri;
    }
  }
}

const ABILITY_BY_FEATURE: Partial<
  Record<AIGatewayModel.ModelFeatures, string>
> = {
  inputAudio: "audio",
  inputFile: "file",
  inputImage: "image",
  inputVideo: "video",
};

/** What a model takes besides text, and whether it thinks, one word each. */
function abilities(model: AIGatewayModel.Type): string[] {
  const words = model.features.flatMap(
    (feature) => ABILITY_BY_FEATURE[feature] ?? [],
  );
  const reasoning = model.reasoning;
  if (
    reasoning &&
    (reasoning.efforts.length > 0 ||
      reasoning.enabledByDefault ||
      reasoning.mandatory)
  ) {
    words.push("reasoning");
  }
  return words;
}

/** A price the way a person writes one: no trailing zeros, at most a tenth of a cent. */
function dollars(perMillionTokens: number): string {
  return String(Number(perMillionTokens.toFixed(3)));
}

function table(header: string[], rows: string[][]): string {
  const all = [header, ...rows];
  const last = header.length - 1;
  const widths = header.map((_, column) =>
    Math.max(...all.map((row) => (row[column] ?? "").length)),
  );
  return `${all
    .map((row) =>
      row
        .map((value, column) =>
          column === last ? value : value.padEnd(widths[column] ?? 0),
        )
        .join("  ")
        .trimEnd(),
    )
    .join("\n")}\n`;
}
