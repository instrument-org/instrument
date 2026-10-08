import { dedent } from "radashi";
import { z } from "zod";

/** The glyphs a written task may wear, named the way the setup page draws them. */
export const SETUP_TASK_ICONS = [
  "airplane",
  "calendar",
  "chart",
  "code",
  "envelope",
  "file",
  "graduation",
  "house",
  "list",
  "magnifier",
  "megaphone",
  "money",
  "palette",
  "pencil",
  "tag",
  "users",
] as const;

export const SetupTaskSchema = z.object({
  detail: z.string().min(1),
  icon: z.enum(SETUP_TASK_ICONS).catch("list"),
  /** Whether the task starts by asking for a file, which setup leaves unchecked. */
  needsFile: z.boolean().catch(false),
  prompt: z.string().min(1),
});

export const SetupTasksSchema = z.object({
  /** Who the tasks were written for, as a phrase: "a small bakery that does its own marketing". */
  summary: z.string(),
  tasks: z.array(SetupTaskSchema).min(1),
});

/** How many tasks setup offers. */
export const SETUP_TASK_COUNT = 4;

export const SETUP_TASKS_INSTRUCTIONS = dedent`
  You write the first few tasks a new person could hand to Instrument, a desktop assistant that does real work on their computer and on the web: it researches, writes documents and pages into their Instrument folder, edits spreadsheets, and drafts messages. It never sends anything on its own.

  You are told what fills the person's week. Write exactly ${SETUP_TASK_COUNT} tasks they would plausibly want done this week, each one specific to what they told you.

  Each task has:
  - "prompt": what the person would type, in their own voice, one or two sentences, first person ("me", "our"). Concrete, never generic.
  - "detail": one short plain sentence saying what happens when it runs, like "Uses the web. Saves a page to your Instrument folder.", "Makes a calendar you can edit.", "You'll pick the file when you start it.", or "Writes a draft. Nothing is sent."
  - "icon": one of ${SETUP_TASK_ICONS.join(", ")}.
  - "needsFile": true only when the task works on a file the person has to choose.

  Also write "summary": who these are for, as a short phrase that completes "Written for ...", like "a small bakery that does its own marketing". No period.

  Answer with only a JSON object of the form {"summary": string, "tasks": [...]}, and nothing before or after it.
`;

/** What the model is told about the person. */
export function setupTasksMessage({
  work,
  workOther,
}: {
  work: readonly string[];
  workOther: string;
}): string {
  const lines = [];
  if (work.length > 0) {
    lines.push(`What fills my week: ${work.join(", ")}.`);
  }
  if (workOther.trim()) {
    lines.push(`In my own words: ${workOther.trim()}`);
  }
  return lines.length > 0 ? lines.join("\n") : "I did not say what I do.";
}

/**
 * The tasks out of a model's answer: the first JSON object in it, read past
 * any thinking, fences, or words around it, and cut to the count setup
 * offers. Nothing when no object in it has the shape.
 */
export function parseSetupTasks(
  text: string,
): undefined | z.output<typeof SetupTasksSchema> {
  const answer = text
    .replaceAll(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/g, "")
    .replaceAll(/```(?:json)?/g, "");
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(answer.slice(start, end + 1));
  } catch {
    return undefined;
  }
  const parsed = SetupTasksSchema.safeParse(json);
  if (!parsed.success) {
    return undefined;
  }
  return {
    summary: parsed.data.summary.trim().replace(/\.$/, ""),
    tasks: parsed.data.tasks.slice(0, SETUP_TASK_COUNT),
  };
}
