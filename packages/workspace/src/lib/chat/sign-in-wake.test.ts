import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { isWaitingOnSignIn } from "./sign-in-wake";

type Message = SessionMessage.WithParts;

// Only what the reader looks at: each message's role and its parts' types and
// outputs. The rest of a stored message is beside the point here.
const said = (role: "assistant" | "user", ...parts: object[]) =>
  ({ parts, role }) as unknown as Message;

const image = (output: object) => ({
  output,
  state: "output-available",
  type: "tool-generate_image",
});
const noImageModel = image({ errorType: "no-image-model", state: "failure" });
const typed = { text: "Make it darker", type: "text" };
const woken = { data: { waitedFor: "image" }, type: "data-signedIn" };

describe("isWaitingOnSignIn", () => {
  it.each<[string, Message[], boolean]>([
    [
      "the last image found nothing to make it with",
      [said("user", typed), said("assistant", noImageModel)],
      true,
    ],
    [
      "the person wrote since",
      [said("assistant", noImageModel), said("user", typed)],
      false,
    ],
    [
      "a note woke the chat since, which is not the person writing",
      [said("assistant", noImageModel), said("user", woken)],
      true,
    ],
    [
      "a later image was made",
      [
        said("assistant", noImageModel),
        said("assistant", image({ state: "success" })),
      ],
      false,
    ],
    [
      "the image was refused for the plan rather than for a sign-in",
      [said("assistant", image({ errorType: "refused", state: "failure" }))],
      false,
    ],
    ["no image was asked for", [said("user", typed)], false],
  ])("%s", (_label, messages, expected) => {
    expect(isWaitingOnSignIn(messages)).toBe(expected);
  });
});
