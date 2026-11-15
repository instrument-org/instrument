import { type SessionMessageDataPart } from "../../src/schemas/session/message-data-part";
import { type Assertion, defineEval } from "../harness";

/**
 * A file the agent revises is changed in place, each turn's reply keeps a
 * version of what it listed, and asked to go back the agent finds the
 * earlier version in `.versions/` and copies it back.
 */

type Kept = SessionMessageDataPart.FileVersionsDataPart["files"][number];

/** Each reply's kept versions, in order. */
const keptByReply = (
  sessions: Parameters<Assertion["check"]>[0]["sessions"],
): Kept[][] =>
  sessions
    .flatMap((session) => session.messages)
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "data-fileVersions" ? [part.data.files] : [],
      ),
    );

const assertInPlace: Assertion = {
  check: ({ sessions }) => {
    const text = "Revises one file in place rather than writing variants";
    const paths = new Set(
      keptByReply(sessions)
        .flat()
        .map((file) => file.hostPath),
    );
    return {
      evidence: `Replies listed ${[...paths].join(", ") || "nothing"}`,
      passed: paths.size === 1,
      text,
    };
  },
  text: "Revises one file in place rather than writing variants",
};

const assertWentBack: Assertion = {
  check: ({ sessions }) => {
    const text = "Going back restores the first version's contents";
    const kept = keptByReply(sessions).map((files) => files[0]?.hash);
    const [first, second, , last] = kept;
    return {
      evidence: `Hashes by reply: ${kept.map((hash) => hash?.slice(0, 8) ?? "none").join(", ")}`,
      passed: kept.length >= 4 && first !== second && last === first,
      text,
    };
  },
  text: "Going back restores the first version's contents",
};

export const FILE_VERSIONS_EVALS = [
  defineEval({
    assertions: [assertInPlace, assertWentBack],
    followUps: [
      "make the moon bigger",
      "and even bigger",
      "hmm, actually go back to the very first one",
    ],
    name: "file-versions-revise-and-go-back",
    prompt:
      "Draw me an SVG of a purple moon over a dark hilltop observatory and show it to me.",
  }),
];
