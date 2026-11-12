import { skillMentionLabel } from "@instrument-org/shared/skill-mention";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";

type SetupChange =
  SessionMessageDataPart.SetupChangesDataPart["changes"][number];

/**
 * What a chat says it did to one item of the person's setup, as the words
 * around the item's name, so the app can make the name a link and a
 * transcript can write the sentence out. `label` replaces how the name is
 * shown, for a skill that is not invoked by its slash form.
 */
export function setupChangeSentence(
  { change, kind, name }: SetupChange,
  { label }: { label?: string } = {},
): { after: string; before: string; label: string } {
  switch (kind) {
    case "app": {
      return {
        after: " app.",
        before:
          change === "added"
            ? "Added the "
            : change === "changed"
              ? "Updated the "
              : "Removed the ",
        label: label ?? name,
      };
    }
    case "memory": {
      // A memory is its file, which is how the person finds it again.
      const file = label ?? `${name}.md`;
      return change === "added"
        ? { after: " to your memories.", before: "Saved ", label: file }
        : change === "changed"
          ? { after: " in your memories.", before: "Updated ", label: file }
          : { after: " from your memories.", before: "Removed ", label: file };
    }
    case "skill": {
      return {
        after: " skill.",
        before:
          change === "added"
            ? "Created the "
            : change === "changed"
              ? "Updated the "
              : "Removed the ",
        label: label ?? skillMentionLabel(name),
      };
    }
    case "project": {
      return {
        after: " project.",
        before:
          change === "added"
            ? "Created the "
            : change === "changed"
              ? "Updated the "
              : "Removed the ",
        label: label ?? name,
      };
    }
  }
}

/** The kinds a card of their own lists: memories and skills. */
type CardKind = Exclude<SetupChange["kind"], "app" | "project">;

const CARD_WORDS: Record<
  CardKind,
  {
    a: string;
    did: Record<SetupChange["change"], string>;
    line: Record<SetupChange["change"], string>;
    many: string;
  }
> = {
  memory: {
    a: "a memory",
    did: { added: "Saved", changed: "Updated", removed: "Forgot" },
    line: { added: "Saved", changed: "Updated", removed: "Forgotten" },
    many: "memories",
  },
  skill: {
    a: "a skill",
    did: { added: "Created", changed: "Updated", removed: "Removed" },
    line: { added: "Created", changed: "Updated", removed: "Removed" },
    many: "skills",
  },
};

/**
 * A card's heading, from what the turn did to its memories or skills: what
 * was done when it did one thing ("Saved 2 memories", "Created a skill"),
 * else how many changed ("Changed 3 memories").
 */
export function setupChangesHeading(
  kind: CardKind,
  changes: readonly Pick<SetupChange, "change">[],
): string {
  const words = CARD_WORDS[kind];
  const count = changes.length;
  const things = count === 1 ? words.a : `${count.toString()} ${words.many}`;
  const done = new Set(changes.map((change) => change.change));
  const [only] = done;
  return done.size === 1 && only
    ? `${words.did[only]} ${things}`
    : `Changed ${things}`;
}

/** What happened to one memory or skill, as its row's line says it: "Saved", "Forgotten". */
export function setupChangeWord(
  kind: CardKind,
  change: SetupChange["change"],
): string {
  return CARD_WORDS[kind].line[change];
}
