import { type SessionMessageDataPart } from "../../src/schemas/session/message-data-part";
import { type Assertion, defineEval } from "../harness";

/**
 * A file the agent revises is changed in place, each turn's reply keeps a
 * version of what it listed, and asked to go back the agent finds the
 * earlier version in `.versions/` and copies it back. The picture case is
 * the one where copying is the only way back: a generated image cannot be
 * made again from memory.
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
        part.type === "data-fileVersions" && part.data.kind === undefined
          ? [part.data.files]
          : [],
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
  defineEval({
    assertions: [assertInPlace, assertWentBack],
    followUps: [
      "make it nighttime",
      "now add a full moon",
      "hmm, actually go back to the very first one",
    ],
    name: "file-versions-image-go-back",
    prompt: "Make me a picture of a red fox in a snowy forest.",
  }),
  // A picture drawn with code and marked up twice, where each mark-up has
  // to land in the same file for Undo changes to put the previous one back.
  defineEval({
    assertions: [assertInPlace],
    followUps: [
      "add a red box around the tallest bar",
      "now add a blue box around the shortest one too",
    ],
    name: "file-versions-mark-up-picture",
    prompt: "Make me a PNG bar chart of three bars: 4, 7 and 2.",
  }),
];
