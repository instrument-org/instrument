import fs from "node:fs";
import path from "node:path";

import { type SessionMessage } from "../../src/schemas/session/message";
import { type SessionMessagePart } from "../../src/schemas/session/message-part";
import { type Assertion, defineEval } from "../harness";
import { fail, pass } from "./handoff";
import { textOf } from "./reply-links";

/**
 * Which pictures go to the image model and which are drawn with code.
 *
 * A person asking for a picture never says "AI". What they send says which
 * they mean: a photo to put things into is a scene, which pasting cut-outs
 * onto it never makes; a chart or an exact layout is a drawing, which a
 * script gets right and an image model gets wrong. Each prompt is worded the
 * way a person words it, and none names the tool.
 *
 * No case needs an image made: each is scored on the call, so a run with no
 * image provider connected scores the same as one with.
 */

type ImageCall = Extract<
  SessionMessagePart.Type,
  { type: "tool-generate_image" }
>;

const fixture = (...segments: string[]) =>
  fs
    .readFileSync(path.resolve(import.meta.dirname, "../fixtures", ...segments))
    .toString("base64");

const PHOTO = "flower-pots.jpg";
const ICONS = ["star", "bolt", "wheel", "heart"].map((name) => ({
  content: fixture("image-tool-choice", `icon-${name}.png`),
  filename: `icon-${name}.png`,
}));

const imageCallsIn = (messages: SessionMessage.WithParts[]): ImageCall[] =>
  messages.flatMap((message) =>
    message.parts.filter(
      (part): part is ImageCall => part.type === "tool-generate_image",
    ),
  );

const allMessages = (sessions: Parameters<Assertion["check"]>[0]["sessions"]) =>
  sessions.flatMap((session) => session.messages);

/** The shell commands a run made, for saying what it did instead. */
const shellCount = (messages: SessionMessage.WithParts[]) =>
  messages.flatMap((message) =>
    message.parts.filter((part) => part.type === "tool-bash"),
  ).length;

const assertUsesTheImageModel: Assertion = {
  check: ({ sessions }) => {
    const text = "Makes the picture with the image model";
    const messages = allMessages(sessions);
    const calls = imageCallsIn(messages);
    return calls.length > 0
      ? pass(text, `${String(calls.length)} generate_image call(s)`)
      : fail(
          text,
          `Never called generate_image; ${String(shellCount(messages))} shell command(s)`,
        );
  },
  text: "Makes the picture with the image model",
};

const assertSendsThePhoto: Assertion = {
  check: ({ sessions }) => {
    const text = "Sends the person's photo as a source image";
    const sources = imageCallsIn(allMessages(sessions)).flatMap(
      (call) => call.input?.sourceImages ?? [],
    );
    return sources.some((source) => source?.endsWith(PHOTO))
      ? pass(text, sources.join(", "))
      : fail(text, `Source images: ${sources.join(", ") || "none"}`);
  },
  text: "Sends the person's photo as a source image",
};

const assertDrawsWithCode: Assertion = {
  check: ({ sessions }) => {
    const text = "Draws it with code, without the image model";
    const calls = imageCallsIn(allMessages(sessions));
    return calls.length === 0
      ? pass(text, "No generate_image call")
      : fail(
          text,
          `Called generate_image: ${calls.map((call) => call.input?.prompt?.slice(0, 80) ?? "").join(" | ")}`,
        );
  },
  text: "Draws it with code, without the image model",
};

const PASTED_ON = "look pasted on";

/** The run's messages before the follow-up, and from it on. */
function aroundFollowUp(messages: SessionMessage.WithParts[]) {
  const asked = messages.findIndex(
    (message) => message.role === "user" && textOf(message).includes(PASTED_ON),
  );
  return asked === -1
    ? undefined
    : { after: messages.slice(asked), before: messages.slice(0, asked) };
}

const assertLayoutDrawnWithCode: Assertion = {
  check: ({ sessions }) => {
    const text = "Lays out the exact banner with code";
    const turns = aroundFollowUp(allMessages(sessions));
    if (!turns) {
      return fail(text, "The follow-up was never sent");
    }
    const calls = imageCallsIn(turns.before);
    return calls.length === 0
      ? pass(text, `${String(shellCount(turns.before))} shell command(s)`)
      : fail(text, `${String(calls.length)} generate_image call(s) first`);
  },
  text: "Lays out the exact banner with code",
};

const assertSwitchesWhenCalledFlat: Assertion = {
  check: ({ sessions }) => {
    const text = "Switches to the image model once the picture is called flat";
    const turns = aroundFollowUp(allMessages(sessions));
    if (!turns) {
      return fail(text, "The follow-up was never sent");
    }
    const calls = imageCallsIn(turns.after);
    return calls.length > 0
      ? pass(text, `${String(calls.length)} generate_image call(s) after it`)
      : fail(
          text,
          `Never called generate_image; ${String(shellCount(turns.after))} more shell command(s)`,
        );
  },
  text: "Switches to the image model once the picture is called flat",
};

export const IMAGE_TOOL_CHOICE_EVALS = [
  defineEval({
    assertions: [assertUsesTheImageModel, assertSendsThePhoto],
    files: [
      { content: fixture("image-tool-choice", PHOTO), filename: PHOTO },
      ...ICONS,
    ],
    name: "image-tool-photo-filled-with-icons",
    prompt:
      "can you make an image that shows these flower pots filled with these icons",
  }),
  defineEval({
    assertions: [assertLayoutDrawnWithCode, assertSwitchesWhenCalledFlat],
    files: ICONS,
    followUps: [
      `hmm, they ${PASTED_ON}. can they be real 3D objects sitting on a table?`,
    ],
    name: "image-tool-after-flat-layout",
    prompt:
      "Put these four icons in a row on a plain white 1200x400 banner, evenly spaced, and save it as a PNG.",
  }),
  defineEval({
    assertions: [assertDrawsWithCode],
    files: [
      {
        content: fixture("Data", "regional-sales.csv"),
        filename: "regional-sales.csv",
      },
    ],
    name: "image-tool-not-for-a-chart",
    prompt:
      "make me an image of revenue by region from this, something I can drop into a slide",
  }),
];
