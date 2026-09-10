/**
 * Does `create-page` get reached for when it should, and left alone when it
 * should not?
 *
 * The task prompt names the skill and tells the model to err toward it for
 * anything long, structured, or worth keeping; the orchestrator's brief rule
 * names it for the same deliverables and whenever the user asks for a page.
 * Both are prompt lines, so neither can be read off the source.
 *
 * A sandboxed eval home holds far fewer skills than a real machine, so the
 * catalog here shows every description whole and the shortening step never
 * fires. What these measure is whether the model acts on a description it can
 * see and a brief that names the skill; `skill-catalog.test.ts` is what covers
 * the description surviving a crowded catalog.
 */
import { SKILL_NAMES } from "../../src/lib/skill-names";
import { type Session } from "../../src/schemas/session";
import { type SessionMessagePart } from "../../src/schemas/session/message-part";
import { type Assertion, type AssertionResult, defineEval } from "../harness";

/** The skill by its plain name or by any source-qualified spelling of it. */
function isCreatePageName(name: unknown): boolean {
  return (
    typeof name === "string" &&
    (name === SKILL_NAMES.createPage ||
      name.endsWith(`:${SKILL_NAMES.createPage}`))
  );
}

function isLoadCreatePagePart(part: SessionMessagePart.Type): boolean {
  return part.type === "tool-load_skill" && isCreatePageName(part.input?.name);
}

function loadedCreatePage(sessions: Session.WithMessagesAndParts[]): boolean {
  return sessions.some((session) =>
    session.messages.some((message) =>
      message.parts.some(isLoadCreatePagePart),
    ),
  );
}

/** Every `task new` the conversation ran, brief included. */
function briefs(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type !== "tool-bash") {
          return [];
        }
        const command: string | undefined = part.input?.command;
        return command !== undefined &&
          /(?:^|[\n;&|])\s*task new\b/.test(command)
          ? [command]
          : [];
      }),
    ),
  );
}

function fail(text: string, evidence: string): AssertionResult {
  return { evidence, passed: false, text };
}

function pass(text: string, evidence: string): AssertionResult {
  return { evidence, passed: true, text };
}

const loadsCreatePage: Assertion = {
  check: ({ sessions }) => {
    const text = `loads the ${SKILL_NAMES.createPage} skill`;
    return loadedCreatePage(sessions)
      ? pass(text, `found a load_skill call for ${SKILL_NAMES.createPage}`)
      : fail(text, `no load_skill call for ${SKILL_NAMES.createPage}`);
  },
  text: `loads the ${SKILL_NAMES.createPage} skill`,
};

const leavesCreatePageAlone: Assertion = {
  check: ({ sessions }) => {
    const text = `does not load the ${SKILL_NAMES.createPage} skill for a file the user named by format`;
    return loadedCreatePage(sessions)
      ? fail(text, `loaded ${SKILL_NAMES.createPage} anyway`)
      : pass(text, `no load_skill call for ${SKILL_NAMES.createPage}`);
  },
  text: `does not load the ${SKILL_NAMES.createPage} skill for a file the user named by format`,
};

/** The conversation cannot load a skill, so the brief is where it names one. */
const briefNamesCreatePage: Assertion = {
  check: ({ sessions }) => {
    const text = `the brief names the ${SKILL_NAMES.createPage} skill`;
    const all = briefs(sessions);
    const naming = all.filter((brief) =>
      brief.includes(SKILL_NAMES.createPage),
    );
    return naming.length > 0
      ? pass(text, `${naming.length} of ${all.length} briefs name it`)
      : fail(
          text,
          all.length === 0
            ? "no task was started"
            : `none of ${all.length} briefs name it: ${all.map((brief) => brief.split("\n").slice(1, 3).join(" ")).join(" | ")}`,
        );
  },
  text: `the brief names the ${SKILL_NAMES.createPage} skill`,
};

const tasksLoadedCreatePage: Assertion = {
  check: async ({ childSessions }) => {
    const text = `a task loaded the ${SKILL_NAMES.createPage} skill`;
    const children = await childSessions();
    if (children.length === 0) {
      return fail(text, "no task was started");
    }
    const loaded = children.filter((child) => loadedCreatePage(child.sessions));
    const evidence = children
      .map(
        (child) =>
          `${child.title}: ${loadedCreatePage(child.sessions) ? "loaded" : "did not load"}`,
      )
      .join("; ");
    return loaded.length > 0 ? pass(text, evidence) : fail(text, evidence);
  },
  text: `a task loaded the ${SKILL_NAMES.createPage} skill`,
};

const stopOnLoadCreatePage = (part: SessionMessagePart.Type) =>
  isLoadCreatePagePart(part) &&
  "state" in part &&
  part.state === "output-available";

const stopOnFirstWrite = (part: SessionMessagePart.Type) =>
  part.type === "tool-write_file" &&
  "state" in part &&
  part.state === "output-available";

export const CREATE_PAGE_SKILL_EVALS = [
  defineEval({
    // Plainly a document, no format named: the skill's own case.
    assertions: [loadsCreatePage],
    name: "create-page-for-a-document",
    prompt:
      "Put together a one-page guide to choosing a home espresso machine under $500: the three things that matter, what to skip, and a short list of picks. I want to print it and hand it to my brother.",
    shouldStop: stopOnLoadCreatePage,
  }),

  defineEval({
    // The negative control. Following a named format is correct, and an eval
    // that punished it would push the agent to override what the user asked.
    assertions: [leavesCreatePageAlone],
    name: "create-page-not-for-a-named-markdown-file",
    prompt: "Write a short note on what a CDN is to output/cdn.md.",
    shouldStop: stopOnFirstWrite,
  }),

  defineEval({
    // The user names the ability. The conversation has no skill tool of its
    // own, so the whole of the answer is a brief that names the skill.
    assertions: [briefNamesCreatePage, tasksLoadedCreatePage],
    kind: "orchestrator",
    name: "orchestrator-create-page-by-name",
    prompt:
      "Can you use your create page ability to just make me a quick and small demo page? I want to just demonstrate the functionality here",
  }),

  defineEval({
    // Nothing named: a long deliverable is a page, and the brief has to say so.
    assertions: [briefNamesCreatePage, tasksLoadedCreatePage],
    kind: "orchestrator",
    name: "orchestrator-create-page-for-a-long-answer",
    prompt:
      "Put together a one-page guide to choosing a home espresso machine under $500 and put it in my Instrument folder.",
  }),
];
