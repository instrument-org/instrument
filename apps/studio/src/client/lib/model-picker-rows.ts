import { type AIGatewayModel } from "@instrument-org/ai-gateway/client";
import { type AIProviderType, OUR_MODELS } from "@instrument-org/shared";
import uFuzzy from "@leeoniya/ufuzzy";

import { joinFuzzyFields } from "./join-fuzzy-fields";

/**
 * What the model picker lays out, as data: the connections its rail lists and
 * the rows each one's list shows. Pure, so what a list holds for a given
 * catalog is checked in node rather than by opening the panel.
 */

/** One connected provider: a key, a plan, or Instrument. Two keys of one kind are two connections. */
export interface Connection {
  id: string;
  isOurs: boolean;
  /** As Settings names it: "Anthropic", "ChatGPT plan", or an account's email when there are several. */
  name: string;
  provider: AIProviderType;
}

export type PickerRow =
  | { model: AIGatewayModel.Type; type: "auto" }
  | { label: string; type: "header" }
  | {
      /** Under a search, where the name came from, for the highlight. */
      nameRanges?: null | number[];
      model: AIGatewayModel.Type;
      /** Whose model it is, drawn only where a list mixes makers. */
      showMaker: boolean;
      /** One plain line under the name: what replaced it, or why it cannot be used. */
      sub?: string;
      type: "model";
    };

/** A catalog this long opens on what we recommend, with the rest one press away. */
const LONG_CATALOG = 25;

const isOurs = (model: AIGatewayModel.Type) =>
  model.params.provider === OUR_MODELS.providerType;

const isAuto = (model: AIGatewayModel.Type) =>
  model.providerId === OUR_MODELS.text.id;

/** The connections in the order the list names them, Instrument first. */
export function connectionsOf(models: AIGatewayModel.Type[]): Connection[] {
  const byId = new Map<string, Connection>();
  for (const model of models) {
    const id = model.params.providerConfigId;
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        isOurs: isOurs(model),
        name: model.providerName.trim(),
        provider: model.params.provider,
      });
    }
  }
  return [...byId.values()].toSorted(
    (a, b) => Number(b.isOurs) - Number(a.isOurs),
  );
}

/** Whether a connection's list is long enough to open on its recommendations. */
export function isLongCatalog(
  models: AIGatewayModel.Type[],
  connectionId: string,
): boolean {
  const own = models.filter(
    (model) => model.params.providerConfigId === connectionId,
  );
  return (
    own.length >= LONG_CATALOG &&
    own.some((model) => model.tags.includes("recommended"))
  );
}

/**
 * One connection's list. Instrument leads with Auto. Models that something
 * newer replaced go under Older versions, each saying what replaced it, and
 * ones this user cannot run go last, saying why. A long catalog shows only
 * its recommendations unless `showAll`, grouped by maker.
 */
export function rowsForConnection({
  connectionId,
  models,
  showAll,
}: {
  connectionId: string;
  models: AIGatewayModel.Type[];
  showAll: boolean;
}): PickerRow[] {
  const own = models.filter(
    (model) => model.params.providerConfigId === connectionId,
  );
  const auto = own.find(isAuto);
  const rest = sortByName(own.filter((model) => !isAuto(model)));
  const showMaker = new Set(rest.map((model) => model.author)).size > 1;
  const row = (model: AIGatewayModel.Type) => modelRow(model, own, showMaker);

  const restricted = rest.filter((model) => model.restricted);
  const older = rest.filter(
    (model) =>
      !model.restricted &&
      (model.replacedBy !== undefined || model.tags.includes("legacy")),
  );
  const latest = rest.filter(
    (model) => !restricted.includes(model) && !older.includes(model),
  );

  const rows: PickerRow[] = auto ? [{ model: auto, type: "auto" }] : [];

  if (isLongCatalog(models, connectionId) && !showAll) {
    const recommended = latest.filter((model) =>
      model.tags.includes("recommended"),
    );
    for (const [maker, group] of groupByMaker(recommended)) {
      rows.push({ label: maker, type: "header" }, ...group.map(row));
    }
    return rows;
  }

  const section = (label: string, group: AIGatewayModel.Type[]) => {
    if (group.length > 0) {
      rows.push({ label, type: "header" }, ...group.map(row));
    }
  };
  // Instrument's own models are a choice beside Auto, which leads; a bare
  // "Latest" over them would read as though Auto were not.
  section(auto ? "Or pick one yourself" : "Latest", latest);
  section("Older versions", older);
  section("Requires a paid plan", restricted);
  return rows;
}

const fuzzy = new uFuzzy({ intraMode: 1 });

/**
 * Every connection searched at once, matches grouped under the connection
 * that serves them, so one model reached three ways reads as three places to
 * get it.
 */
export function rowsForSearch({
  models,
  query,
}: {
  models: AIGatewayModel.Type[];
  query: string;
}): PickerRow[] {
  const rows: PickerRow[] = [];
  for (const connection of connectionsOf(models)) {
    const own = sortByName(
      models.filter((model) => model.params.providerConfigId === connection.id),
    );
    const joined = own.map((model) => joinFuzzyFields([model.name]));
    const haystack = joined.map((fields) => fields.haystack);
    const indexes = fuzzy.filter(haystack, query);
    if (!indexes?.length) {
      continue;
    }
    const info = fuzzy.info(indexes, haystack, query);
    const order = fuzzy.sort(info, haystack, query);
    const showMaker = new Set(own.map((model) => model.author)).size > 1;
    rows.push({ label: connection.name, type: "header" });
    for (const at of order) {
      const index = info.idx[at] ?? -1;
      const model = own[index];
      if (!model) {
        continue;
      }
      if (isAuto(model)) {
        rows.push({ model, type: "auto" });
        continue;
      }
      const [nameRanges] =
        joined[index]?.splitRanges(info.ranges[at] ?? null) ?? [];
      rows.push({
        ...modelRow(model, own, showMaker),
        nameRanges: nameRanges ?? null,
      });
    }
  }
  return rows;
}

/** A model's row: its maker shown or not, and what replaced it or why it cannot be used. */
function modelRow(
  model: AIGatewayModel.Type,
  sameConnection: AIGatewayModel.Type[],
  showMaker: boolean,
): Extract<PickerRow, { type: "model" }> {
  const replacedBy =
    model.replacedBy &&
    sameConnection
      .find((entry) => entry.canonicalId === model.replacedBy)
      ?.name.trim();
  const sub =
    model.restricted?.message ??
    (replacedBy ? `Replaced by ${replacedBy}` : undefined);
  return { model, showMaker, type: "model", ...(sub && { sub }) };
}

const MAKERS: Record<string, string> = {
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  google: "Google",
  "meta-llama": "Meta",
  minimax: "MiniMax",
  mistralai: "Mistral",
  moonshotai: "Moonshot",
  openai: "OpenAI",
  qwen: "Qwen",
  "x-ai": "xAI",
  "z-ai": "Z.ai",
};

/** A maker's name for a heading: the known ones spelled as they spell themselves, the rest capitalized. */
export function makerName(author: string): string {
  return (
    MAKERS[author] ??
    author.replace(
      /(^|-)(\w)/g,
      (_, dash: string, letter: string) =>
        `${dash ? " " : ""}${letter.toUpperCase()}`,
    )
  );
}

function groupByMaker(models: AIGatewayModel.Type[]) {
  const groups = new Map<string, AIGatewayModel.Type[]>();
  for (const model of models) {
    const maker = makerName(model.author);
    groups.set(maker, [...(groups.get(maker) ?? []), model]);
  }
  return [...groups].toSorted(([a], [b]) => a.localeCompare(b));
}

/** By name, numbers read as numbers, except our own, which keep the order the catalog gives. */
function sortByName(models: AIGatewayModel.Type[]) {
  return models.toSorted((a, b) =>
    isOurs(a) && isOurs(b)
      ? 0
      : a.name
          .trim()
          .localeCompare(b.name.trim(), undefined, { numeric: true }),
  );
}
