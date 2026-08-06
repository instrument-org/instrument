import { dedent } from "radashi";

import {
  TASK_FOLDER_NAMES as F,
  PROJECT_INSTRUCTIONS_FILE_NAME,
  PROJECT_MOUNT_POINT,
} from "../constants";

/**
 * The project block injected into the agent's context for tasks started from a
 * project. XML-delimited to match the other context blocks
 * (<attached_folders>, <uploaded_files>). Shared so the markdown transcript can
 * reproduce exactly what the agent receives.
 *
 * The mount is announced but never advertised as something to read: a project
 * folder holds nothing today but the `AGENTS.md` whose contents are already
 * above, so inviting a read here would buy a wasted tool call on every task that
 * fits inside the cap. Only the truncation notice, which appears when part of
 * the file was actually left out, points at reading it. When projects can carry
 * files the user attaches as context, this is where that belongs: what lives
 * there, that reading it beats asking for a copy, and that native tools cannot
 * reach outside the task root.
 *
 * Rendered for every project task, with or without instructions, so that "save
 * this to my project instructions" is something the agent can act on rather than
 * a path it has not been told about.
 */
export function buildProjectContextText({
  instructions,
  name,
}: {
  instructions?: string;
  name: string;
}): string {
  const body = instructions
    ? dedent`
      These instructions apply to the whole task and persist across every turn -- treat them as standing setup, not as something attached in a single message.

      ${instructions}
    `.trim()
    : `It has no instructions set.`;

  return dedent`
    <project_instructions>
    This task belongs to the "${name}" project. ${body}

    The instructions above are \`${PROJECT_MOUNT_POINT}/${PROJECT_INSTRUCTIONS_FILE_NAME}\`, and the project's folder is mounted read-and-write at \`${PROJECT_MOUNT_POINT}/\`. Editing that file changes the standing instructions for every task in this project, so only do that when the user asks you to.

    Everything in \`${PROJECT_MOUNT_POINT}/\` outlives this task, so it is not where this task's work goes: scripts, scratch, and intermediate files belong in \`${F.work}/\`, and finished deliverables in \`${F.output}/\`, the same as outside a project. Deleting a task takes its folder with it and leaves anything here behind, so a file put here without a reason to outlive the task is one nobody will clean up. Write here for something meant to apply to the project's later tasks as well: a convention to follow, a note worth having next time. Something the user asked you to produce is this task's result and belongs in \`${F.output}/\`, even when they mention the project while asking for it.
    </project_instructions>
  `.trim();
}

// Intro for the <attached_folders> block listing a project's folders, so they
// carry the same mount-handling guidance as user-attached folders.
export function projectFoldersIntro(name: string): string {
  return `These folders belong to the "${name}" project and are available throughout this task.`;
}
