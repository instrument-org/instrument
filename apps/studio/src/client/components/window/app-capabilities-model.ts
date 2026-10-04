import { labelOf, listsFirst, type Tool } from "./app-inspector-model";

/** One thing an app lets Instrument do, as a person reads it. */
export interface Capability {
  /** The first sentence of what the app says the action does, when it says. */
  detail?: string;
  label: string;
  name: string;
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
 * An app's tools as what it lets Instrument do: what it reads apart from
 * what it changes, each named in words: lists first among the reads, since
 * they say most plainly what is there, then the app's own order.
 */
export function capabilitiesOf(tools: Tool[]): Capabilities {
  const toCapability = (tool: Tool): Capability => ({
    detail: firstSentence(tool.description),
    label: labelOf(tool),
    name: tool.name,
  });
  return {
    does: tools.filter((tool) => !tool.isRead).map(toCapability),
    finds: tools
      .filter((tool) => tool.isRead)
      .toSorted(listsFirst)
      .map(toCapability),
  };
}
