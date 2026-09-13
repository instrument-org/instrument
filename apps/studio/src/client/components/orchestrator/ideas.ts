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
 * heading names what the reader arrives with rather than what they mean to do
 * with it, since the thing somebody can answer on the way in is what is
 * already on their desk. The same list the website's Discover section uses;
 * a tag with no heading here lands its idea under More.
 */
export const IDEA_GROUPS: { label: string; tag: string }[] = [
  { label: "A decision to make", tag: "decide" },
  { label: "A topic to explain", tag: "explain" },
  { label: "A case to make", tag: "persuade" },
  { label: "Steps to follow", tag: "steps" },
  { label: "Numbers to work with", tag: "data" },
  { label: "A layout to draw", tag: "layout" },
  { label: "A thing to draw", tag: "draw" },
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
  const grouped = IDEA_GROUPS.map((group) => ({
    ...group,
    ideas: ideas.filter((idea) => idea.tags[0] === group.tag),
  })).filter((group) => group.ideas.length > 0);
  const ungrouped = ideas.filter(
    (idea) => !IDEA_GROUPS.some((group) => group.tag === idea.tags[0]),
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
