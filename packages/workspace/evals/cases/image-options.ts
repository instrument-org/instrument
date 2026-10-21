import { type SessionMessagePart } from "../../src/schemas/session/message-part";
import { type Assertion, defineEval } from "../harness";

/**
 * The options the image model takes are per computer and per chat model, so
 * they are told in the session's system information rather than in the
 * `generate_image` definition, which reads the same everywhere. These check
 * the agent still finds them there and passes them as the model takes them.
 *
 * The prompt asks for a shape rather than a knob, since which knob gives a
 * shape depends on the provider: one takes `aspectRatio`, another has none
 * and wants the shape described in the prompt.
 */

type ImageCall = Extract<
  SessionMessagePart.Type,
  { type: "tool-generate_image" }
>;

/** Each `- knob: one of a, b, c` line of the options the session was told. */
function toldOptions(text: string): Map<string, string[]> {
  const options = new Map<string, string[]>();
  for (const match of text.matchAll(/^- (\w+): one of (.+)$/gmu)) {
    const [, knob = "", values = ""] = match;
    options.set(
      knob,
      values.split(",").map((value) => value.trim()),
    );
  }
  return options;
}

const assertUsesToldOptions: Assertion = {
  check: ({ sessions }) => {
    const messages = sessions.flatMap((session) => session.messages);
    const told = messages
      .map((message) =>
        message.role === "session-context"
          ? message.metadata.environment?.imageOptions
          : undefined,
      )
      .find((text) => text !== undefined);
    const calls = messages.flatMap((message) =>
      message.parts.filter(
        (part): part is ImageCall => part.type === "tool-generate_image",
      ),
    );
    const text = "Passes the image options its system information names";
    if (told === undefined) {
      return {
        evidence: "The session was never told the image options",
        passed: false,
        text,
      };
    }
    if (calls.length === 0) {
      return { evidence: "Never called generate_image", passed: false, text };
    }
    const options = toldOptions(told);
    const problems: string[] = [];
    for (const call of calls) {
      const parameters = call.input?.parameters ?? {};
      for (const [knob, value] of Object.entries(parameters)) {
        if (!options.get(knob)?.includes(String(value))) {
          problems.push(
            `${knob}=${String(value)} is not an option it was told`,
          );
        }
      }
      const ratios = options.get("aspectRatio");
      if (ratios?.includes("16:9") && parameters.aspectRatio !== "16:9") {
        problems.push("left out aspectRatio=16:9 though the model takes it");
      }
      if (
        ratios === undefined &&
        !/wide|landscape|16:9|panoram|banner/iu.test(call.input?.prompt ?? "")
      ) {
        problems.push(
          "the model takes no aspect ratio and the prompt never says wide",
        );
      }
    }
    const used = calls
      .map((call) => JSON.stringify(call.input?.parameters ?? {}))
      .join("; ");
    return {
      evidence:
        problems.length === 0
          ? `Told ${[...options.keys()].join(", ") || "no options"}; passed ${used}`
          : problems.join("; "),
      passed: problems.length === 0,
      text,
    };
  },
  text: "Passes the image options its system information names",
};

export const IMAGE_OPTIONS_EVALS = [
  defineEval({
    assertions: [assertUsesToldOptions],
    name: "image-options-from-system-information",
    prompt:
      "Generate an AI image for a wide 16:9 website banner: a red paper lantern glowing over a dark river at night. Save it as banner.",
  }),
];
