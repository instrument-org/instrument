import {
  type AIGatewayModel,
  AIGatewayModelURI,
  fetchModelResultsForProviders,
} from "@instrument-org/ai-gateway";
import { type AIProviderConfigId } from "@instrument-org/shared";

import { type TaskId } from "../../schemas/task-id";
import { taskDir } from "../task-dir-utils";
import { getTaskState } from "../task-record";
import { getWorkspaceConfig } from "../workspace-config";

export type ModelColumn =
  | "context"
  | "effort"
  | "name"
  | "price"
  | "provider"
  | "released"
  | "tags"
  | "takes"
  | "uri";

/**
 * Every model the orchestrator can hand a task, newest first. One provider
 * config only, the conversation's own, because every other one is another
 * account and another bill: the same model is usually listed by several, and
 * a conversation free to pick any of them spends from whichever row it read
 * first. A restricted model is one the signed-in user cannot run, so it is
 * left out rather than listed for a task that would fail on its first
 * request. Models with no release date sort after every dated one, and names
 * break ties.
 */
export async function listRunnableModels(
  providerConfigId: AIProviderConfigId,
): Promise<AIGatewayModel.Type[]> {
  const workspaceConfig = getWorkspaceConfig();
  const results = await fetchModelResultsForProviders(
    workspaceConfig
      .getAIProviderConfigs()
      .filter((config) => config.id === providerConfigId),
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

/**
 * The provider config a conversation runs on, and so the only one its tasks
 * may run on. Undefined until it has been messaged, since a conversation has
 * no model before then.
 */
export async function ownProviderConfigId(
  orchestratorTaskId: TaskId,
): Promise<AIProviderConfigId | undefined> {
  const state = await getTaskState(taskDir(orchestratorTaskId));
  if (!state.selectedModelURI) {
    return undefined;
  }
  const parsed = AIGatewayModelURI.parse(state.selectedModelURI);
  return parsed.ok ? parsed.value.params.providerConfigId : undefined;
}

const ALL_MODEL_COLUMNS: ModelColumn[] = [
  "uri",
  "name",
  "provider",
  "released",
  "context",
  "price",
  "takes",
  "effort",
  "tags",
];

const HEADER: Record<ModelColumn, string> = {
  context: "context",
  effort: "effort",
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
    // The rungs this model takes, so a brief can ask for one and a comparison
    // can be run across them. A model that reasons without saying at what
    // levels shows the ladder it will be asked in, since resolution steps down
    // to whatever it actually supports.
    case "effort": {
      const reasoning = model.reasoning;
      if (!reasoning) {
        return "-";
      }
      const rungs =
        reasoning.efforts.length > 0
          ? reasoning.efforts.join("/")
          : "low/medium/high";
      return reasoning.defaultEffort
        ? `${rungs} (${reasoning.defaultEffort})`
        : rungs;
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
