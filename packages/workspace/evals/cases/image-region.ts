import fs from "node:fs";
import path from "node:path";

import { type SessionMessagePart } from "../../src/schemas/session/message-part";
import { type Assertion, defineEval } from "../harness";

/**
 * Detail that survives in the file and not in the preview.
 *
 * Both fixtures are 8000x6000, which the fixed preview budget renders at
 * 1269x952, so the answer is drawn at a size that lands around three pixels
 * tall by the time the model sees the whole page. It is legible only to a read
 * that goes back to the file, which is what makes these cases evidence: a
 * correct answer is very hard to produce without a `region` read.
 *
 * Each prompt names what to find and never how to find it. Reaching for
 * `region` has to be the model's own idea, or the case is measuring obedience
 * rather than whether the affordance works.
 */
const fixture = (name: string) =>
  fs
    .readFileSync(
      path.resolve(import.meta.dirname, "../fixtures/image-region", name),
    )
    .toString("base64");

const SERIAL = "7F3K-9142-QX58";
const Q3_NORTHEAST = "5,318";

/**
 * A zoom the model meant, matching how the tool reads the same input.
 *
 * `read_file` answers some rectangles with the plain whole image: ones naming
 * no place, which a model family sends on the first read of every image, and
 * ones covering the entire picture, which have nothing in them to magnify. The
 * tool is the authority on which those were, and it marks them. Judging the
 * input here instead made the negative case fail a model whose read the tool
 * had already handled as a plain one -- the eval and the tool disagreeing about
 * what a region read even is.
 */
function isRegionRead(part: SessionMessagePart.Type) {
  if (part.type !== "tool-read_file") {
    return false;
  }
  if (!part.input?.region) {
    return false;
  }
  return (
    part.state !== "output-available" ||
    part.output.state !== "image" ||
    part.output.regionIgnored === undefined
  );
}

const assertReadsARegion: Assertion = {
  check: ({ sessions }) => {
    const reads = sessions.flatMap((session) =>
      session.messages.flatMap((message) =>
        message.parts.filter((part) => isRegionRead(part)),
      ),
    );
    return {
      evidence:
        reads.length > 0
          ? `${reads.length} read_file call(s) passed a region`
          : "No read_file call passed a region",
      passed: reads.length > 0,
      text: "Zooms in with a region read",
    };
  },
  text: "Zooms in with a region read",
};

/**
 * Compares with punctuation and case removed, so a model that reformats what it
 * read still counts as having read it. "ImagePullBackOff" is the same answer as
 * the "image pull backoff" on the page, and an assertion that says otherwise is
 * measuring transcription style rather than whether the pixels were legible.
 */
const normalize = (text: string) =>
  text.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");

function assertAnswerContains(expected: string): Assertion {
  return {
    check: ({ sessions }) => {
      const text = sessions
        .flatMap((session) =>
          session.messages.flatMap((message) =>
            message.parts.map((part) =>
              part.type === "text" ? part.text : "",
            ),
          ),
        )
        .join("\n");
      const found = normalize(text).includes(normalize(expected));
      return {
        evidence: found
          ? `Answer contains "${expected}"`
          : `Answer never mentions "${expected}"`,
        passed: found,
        text: `Reads "${expected}" correctly`,
      };
    },
    text: `Reads "${expected}" correctly`,
  };
}

/**
 * The other half of the guard. A magnified read costs a whole extra request and
 * a second image, so a model that reaches for one on every picture is a cost
 * regression even though every answer is right. This case is small enough to
 * read whole, so the correct behavior is to answer from the first look.
 *
 * Known red for gpt-5.6-terra, which fills in a whole-image `region` on its very
 * first read, before it has seen anything to zoom into. Not flakiness, and not
 * something the tool description fixes: telling the parameter to be omitted on a
 * first read was tried and measured, and produced more speculative reads rather
 * than fewer. Left failing because the expectation is right and the gap is real.
 */
const assertNoRegionRead: Assertion = {
  check: ({ sessions }) => {
    const reads = sessions.flatMap((session) =>
      session.messages.flatMap((message) =>
        message.parts.filter((part) => isRegionRead(part)),
      ),
    );
    return {
      evidence:
        reads.length === 0
          ? "Answered from the first look, with no region read"
          : `${reads.length} region read(s) on an image that needed none`,
      passed: reads.length === 0,
      text: "Does not zoom when the image is already legible",
    };
  },
  text: "Does not zoom when the image is already legible",
};

export const IMAGE_REGION_EVALS = [
  defineEval({
    assertions: [assertReadsARegion, assertAnswerContains(SERIAL)],
    files: [
      { content: fixture("serial-label.png"), filename: "inventory.png" },
    ],
    name: "region-reads-a-serial",
    prompt:
      "This inventory report has an asset serial number on it. What is it? Give me the exact value.",
  }),
  defineEval({
    assertions: [assertReadsARegion, assertAnswerContains(Q3_NORTHEAST)],
    files: [
      {
        content: fixture("revenue-table.png"),
        filename: "quarterly-revenue.png",
      },
    ],
    name: "region-reads-a-table-cell",
    prompt: "What is the Q3 figure for the Northeast region in this table?",
  }),
  defineEval({
    assertions: [
      assertNoRegionRead,
      assertAnswerContains("image pull backoff"),
    ],
    files: [{ content: fixture("legible-status.png"), filename: "status.png" }],
    name: "region-not-used-when-legible",
    prompt: "Why did this deployment fail?",
  }),
];
