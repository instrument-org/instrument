/**
 * Does the agent take in what a connected MCP server says about itself?
 *
 * A hosted server sends instructions at the handshake and often points them
 * at documents it serves (Notion's send the agent to its own docs). Beacon's
 * instructions say to read its filing rules before filing, and the rules,
 * a resource on the server and nowhere else, ask every new issue to carry a
 * label. The case files a bug and is scored on the labels the tracker says
 * it filed the issue with, so it passes only when the agent read the
 * instructions and followed them to the document.
 */
import { type Session } from "../../src/schemas/session";
import { type AppFixture } from "../lib/connected-app";
import { FILING_LABEL } from "../lib/mcp-tracker";
import { type Assertion, defineEval } from "../harness";

const BEACON: AppFixture = { kind: "mcp", name: "Beacon", slug: "beacon" };

const LABELS_AS_THE_RULES_SAY = `files the issue with the "${FILING_LABEL}" label the server's rules ask for`;

// The tracker's answer to `create_issue`, which names the labels it filed.
const FILED_WITH_LABEL = new RegExp(
  String.raw`"labels":\s*\[[^\]]*"${FILING_LABEL}"`,
);

/** What the shell printed for each bash call, where it finished. */
function bashOutputs(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-bash" && part.state === "output-available"
          ? [part.output.output]
          : [],
      ),
    ),
  );
}

/** The tracker filed an issue with the label the filing rules ask for. */
const labelsAsTheRulesSay: Assertion = {
  check: ({ sessions }) => {
    const text = LABELS_AS_THE_RULES_SAY;
    const filed = bashOutputs(sessions)
      .map((output) => output.match(FILED_WITH_LABEL)?.[0])
      .find((match) => match !== undefined);
    return filed
      ? { evidence: filed, passed: true, text }
      : {
          evidence: "the tracker filed no issue with the label",
          passed: false,
          text,
        };
  },
  text: LABELS_AS_THE_RULES_SAY,
};

export const APP_GUIDANCE_EVALS = [
  defineEval({
    apps: [BEACON],
    assertions: [labelsAsTheRulesSay],
    name: "app-follows-server-guidance",
    prompt: "File a bug in Beacon: the export button does nothing in Safari.",
  }),
];
