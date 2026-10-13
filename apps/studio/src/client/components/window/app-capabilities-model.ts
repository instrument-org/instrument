import { labelOf, listsFirst, type Tool } from "./app-inspector-model";

/** One thing an app lets Instrument do, as a person reads it. */
export interface Capability {
  /** The first sentence of what the app says the action does, when it says. */
  detail?: string;
  label: string;
  name: string;
  /** A look-up that takes nothing it must be given, so it can be tried with one press. */
  runsAsIs: boolean;
}

/** What the app lets Instrument look at, and what it lets Instrument change. */
export interface Capabilities {
  does: Capability[];
  finds: Capability[];
}

/** Past this, a description's first sentence is cut and ends in an ellipsis. */
const DETAIL_LIMIT = 140;

/**
 * The first sentence of a description: the first line with words on it, up
 * to where its first sentence ends, without Markdown's emphasis or code ticks.
 */
export function firstSentence(text: string): string | undefined {
  const line = text
    .split("\n")
    .map((candidate) => candidate.replace(/^[#>*\-\s]+/, "").trim())
    .find((candidate) => candidate.length > 0);
  if (!line) {
    return undefined;
  }
  const plain = line.replace(/[*_`]+/g, "");
  const end = /[.!?](?=\s|$)/.exec(plain);
  const sentence = end ? plain.slice(0, end.index + 1) : plain;
  return sentence.length > DETAIL_LIMIT
    ? `${sentence.slice(0, DETAIL_LIMIT - 1).trimEnd()}…`
    : sentence;
}

/**
 * About the app itself rather than the person's data in it: its skills, its
 * docs, its help. True to the app, and nothing much to look at.
 */
const ABOUT_THE_APP =
  /(?:^|[-_])(?:skills?|docs?|documentation|help)(?:[-_]|$)/i;

/**
 * The order a person browsing wants the reads in: what opens on one press
 * first, then the person's own data before what describes the app, then
 * lists, since they say most plainly what is there.
 */
function browsableFirst(a: Capability, b: Capability): number {
  const isAbout = (item: Capability) => ABOUT_THE_APP.test(item.name);
  return (
    Number(b.runsAsIs) - Number(a.runsAsIs) ||
    Number(isAbout(a)) - Number(isAbout(b))
  );
}

/**
 * An app's tools as what it lets Instrument do: what it reads apart from
 * what it changes, each named in words, the reads in the order a person
 * browsing wants them and otherwise in the app's own.
 */
export function capabilitiesOf(tools: Tool[]): Capabilities {
  const toCapability = (tool: Tool): Capability => ({
    detail: firstSentence(tool.description),
    label: labelOf(tool),
    name: tool.name,
    runsAsIs: tool.isRead && tool.params.every((param) => !param.required),
  });
  return {
    does: tools.filter((tool) => !tool.isRead).map(toCapability),
    finds: tools
      .filter((tool) => tool.isRead)
      .toSorted(listsFirst)
      .map(toCapability)
      .toSorted(browsableFirst),
  };
}
