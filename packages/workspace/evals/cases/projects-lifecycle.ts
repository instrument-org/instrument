/**
 * Does the chat make and delete projects with `instrument projects`, so the
 * file it writes has only keys the app knows and a delete can be undone?
 *
 * - **projects-create.** Asked for a new project with an icon. Scored on
 *   the project's file: its id written down and no key the app does not
 *   know, as a folder made by hand with a `name:` key had.
 * - **projects-delete.** Asked to delete a project. Scored on the project
 *   being retired, as the app's Delete does, its folder still there, and on
 *   no `rm` of a folder in `Projects/`.
 */
import { createProject, listProjects } from "../../src/lib/chat/projects";
import { type Assertion, defineEval } from "../harness";
import { fail, pass } from "./handoff";

/** Every bash command the chat ran. */
function commandsOf(ctx: Parameters<Assertion["check"]>[0]): string[] {
  return ctx.sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-bash" && typeof part.input?.command === "string"
          ? [part.input.command]
          : [],
      ),
    ),
  );
}

const madeByCommand: Assertion = {
  check: async (ctx) => {
    const text = "made the project with instrument projects create";
    const made = (await listProjects()).find((project) =>
      /garden/i.test(project.name),
    );
    const ran = commandsOf(ctx).some((command) =>
      /\binstrument projects create\b(?![^;&|]*--help)/.test(command),
    );
    const evidence = made
      ? `${made.name}: icon ${made.icon ?? "-"}, ${made.unsaved ? "no id in its file" : "id written"}, unknown keys ${Object.keys(made.others ?? {}).join(", ") || "none"}; create ran: ${String(ran)}`
      : "no project named for the garden";
    return made && ran && !made.unsaved && made.others === undefined
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "made the project with instrument projects create",
};

const deletedByRetiring: Assertion = {
  check: async (ctx) => {
    const text = "deleted the project by retiring it, never rm";
    const kitchen = (await listProjects()).find(
      (project) => project.name === "Kitchen",
    );
    const removed = commandsOf(ctx).filter((command) =>
      /\brm\b[^;&|]*Projects\//.test(command),
    );
    const evidence = `${kitchen ? `Kitchen ${kitchen.retired ? "retired" : "in use"}` : "Kitchen's folder gone"}; ${removed.length.toString()} rm of a project folder`;
    return kitchen?.retired === true && removed.length === 0
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "deleted the project by retiring it, never rm",
};

export const PROJECTS_LIFECYCLE_EVALS = [
  defineEval({
    assertions: [madeByCommand],
    kind: "chat",
    name: "projects-create",
    prompt: "make me a new project for my vegetable garden, with a plant icon",
  }),
  defineEval({
    assertions: [deletedByRetiring],
    kind: "chat",
    name: "projects-delete",
    prompt: "delete the Kitchen project, I don't need it anymore",
    setup: async () => {
      await createProject({ emoji: "🍳", name: "Kitchen" });
    },
  }),
];
