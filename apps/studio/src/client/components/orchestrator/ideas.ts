// A type-only import, erased in full: this module is what the tab's location
// and presentation read, which node tests import without a window.
import type { RPCOutput } from "@/client/rpc/client";

export type Idea = RPCOutput["ideas"]["list"][number];
export type IdeaExample = Idea["examples"][number];

/** The Ideas screen's address, and an idea's page under it. */
export const IDEAS_HREF = "/orchestrator/ideas";

export function ideaHref(name: string) {
  return `${IDEAS_HREF}/${name}`;
}

/**
 * The groups the index reads the ideas in, by the first tag each carries. A
 * heading names what the reader is here to do, in a few words that read as a
 * shelf label. A group can take more than one tag: drawing a layout and
 * drawing a thing are both brainstorming and design. A tag with no heading
 * here lands its idea under More.
 */
const IDEA_GROUPS: { label: string; tags: string[] }[] = [
  { label: "Make decisions", tags: ["decide"] },
  { label: "Explain topics", tags: ["explain"] },
  { label: "Make a case", tags: ["persuade"] },
  { label: "Plan and prioritize", tags: ["steps"] },
  { label: "Work with data", tags: ["data"] },
  { label: "Brainstorm and design", tags: ["layout", "draw"] },
];

/** What the example shows of the shape, falling back to its subject. */
export function exampleLabel(example: IdeaExample) {
  return example.variant ?? example.title;
}

/** The subject, shown small once the variant is the label. */
export function exampleSubject(example: IdeaExample) {
  return example.variant ? example.title : undefined;
}

/** The ideas as groups, each with the ideas whose first tag it names, in the catalog's order. */
export function groupIdeas(ideas: Idea[]) {
  const isIn = (group: (typeof IDEA_GROUPS)[number], idea: Idea) =>
    group.tags.includes(idea.tags[0] ?? "");
  const grouped = IDEA_GROUPS.map((group) => ({
    ideas: ideas.filter((idea) => isIn(group, idea)),
    label: group.label,
    // The group's first tag keys it, which is all the index needs a tag for.
    tag: group.tags[0] ?? group.label,
  })).filter((group) => group.ideas.length > 0);
  const ungrouped = ideas.filter(
    (idea) => !IDEA_GROUPS.some((group) => isIn(group, idea)),
  );
  if (ungrouped.length > 0) {
    grouped.push({ ideas: ungrouped, label: "More", tag: "more" });
  }
  return grouped;
}

/**
 * The idea's name as its folder spells it, for a tab or a crumb drawn before
 * the catalog has answered: `briefing-memo` reads as "Briefing memo".
 */
export function ideaTitleOf(name: string) {
  const words = name.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
