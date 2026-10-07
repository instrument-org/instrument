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
  /** As Settings names it: "Anthropic", "ChatGPT account", or an account's email when there are several. */
  name: string;
  provider: AIProviderType;
}

export type PickerRow =
  | { model: AIGatewayModel.Type; type: "auto" }
  /** A group's heading; under a search, the connection's, with its icon. */
  | { label: string; provider?: AIProviderType; type: "header" }
  | {
      /** Under a search, where the name came from, for the highlight. */
      nameRanges?: null | number[];
      model: AIGatewayModel.Type;
      /** One plain line under the name: what replaced it, or why it cannot be used. */
      sub?: string;
      type: "model";
    }
  /** The foot of a list opened on its recommendations: the rest, one press away. */
  | { type: "show-all" }
  /** The foot of a list showing everything, when it can be folded back. */
  | { type: "show-fewer" };

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

/** A connection's models other than Auto, sorted into the groups its list shows. */
function groupsOf(models: AIGatewayModel.Type[], connectionId: string) {
  const own = models.filter(
    (model) => model.params.providerConfigId === connectionId,
  );
  const rest = sortByName(own.filter((model) => !isAuto(model)));
  const restricted = rest.filter((model) => model.restricted);
  const older = rest.filter(
    (model) =>
      !model.restricted &&
      (model.replacedBy !== undefined || model.tags.includes("legacy")),
  );
  const latest = rest.filter(
    (model) => !restricted.includes(model) && !older.includes(model),
  );
  const recommended = latest.filter((model) =>
    model.tags.includes("recommended"),
  );
  return {
    auto: own.find(isAuto),
    latest,
    older,
    own,
    recommended,
    restricted,
    // Folding only helps where it hides something and leaves something.
    folds: recommended.length > 0 && recommended.length < rest.length,
  };
}

/**
 * Whether a connection's list, opened folded, would leave `model` out: a
 * chosen model the recommendations skip opens the whole list instead.
 */
export function isFoldedAway(
  models: AIGatewayModel.Type[],
  model: AIGatewayModel.Type,
): boolean {
  const groups = groupsOf(models, model.params.providerConfigId);
  return groups.folds && !isAuto(model) && !groups.recommended.includes(model);
}

/**
 * One connection's list. Instrument leads with Auto. A list with
 * recommendations opens on them, under Recommended, with the rest behind Show
 * all; showing all only adds groups under them, so nothing already on screen
 * moves. Models that something newer replaced go under Older versions, each
 * saying what replaced it, and ones this user cannot run go last, saying why.
 * Every row carries its maker's mark, so the groups are by kind, not maker.
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
  const { auto, folds, latest, older, own, recommended, restricted } = groupsOf(
    models,
    connectionId,
  );
  const row = (model: AIGatewayModel.Type) => modelRow(model, own);
  const rows: PickerRow[] = auto ? [{ model: auto, type: "auto" }] : [];

  const section = (label: string, group: AIGatewayModel.Type[]) => {
    if (group.length > 0) {
      rows.push({ label, type: "header" }, ...group.map(row));
    }
  };

  if (folds) {
    section("Recommended", byMaker(recommended));
    if (!showAll) {
      rows.push({ type: "show-all" });
      return rows;
    }
    section(
      "Other models",
      byMaker(latest.filter((model) => !recommended.includes(model))),
    );
    section("Older versions", older);
    section("Requires a paid plan", restricted);
    rows.push({ type: "show-fewer" });
    return rows;
  }

  // A list with nothing older and nothing out of reach needs no heading over
  // its one group.
  if (older.length > 0 || restricted.length > 0) {
    section("Latest", latest);
  } else {
    rows.push(...latest.map(row));
  }
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
    rows.push({
      label: connection.name,
      provider: connection.provider,
      type: "header",
    });
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
        ...modelRow(model, own),
        nameRanges: nameRanges ?? null,
      });
    }
  }
  return rows;
}

/** A model's row, with what replaced it or why it cannot be used. */
function modelRow(
  model: AIGatewayModel.Type,
  sameConnection: AIGatewayModel.Type[],
): Extract<PickerRow, { type: "model" }> {
  const replacedBy =
    model.replacedBy &&
    sameConnection
      .find((entry) => entry.canonicalId === model.replacedBy)
      ?.name.trim();
  const sub =
    model.restricted?.message ??
    (replacedBy ? `Replaced by ${replacedBy}` : undefined);
  return { model, type: "model", ...(sub && { sub }) };
}

/** Grouped by who made them, so a maker's marks run together down the list. */
function byMaker(models: AIGatewayModel.Type[]) {
  return models.toSorted((a, b) => a.author.localeCompare(b.author));
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
