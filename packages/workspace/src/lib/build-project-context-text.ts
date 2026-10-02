import { dedent } from "radashi";

/**
 * The project block injected into the agent's context for tasks started from a
 * project. XML-delimited to match the other context blocks
 * (<attached_folders>, <uploaded_files>). Shared so the markdown transcript can
 * reproduce exactly what the agent receives.
 *
 * Only a task made before chats replaced projects carries one: the 1.x import
 * moves the project's folder aside, so the block names the project and its
 * instructions and points at nothing on disk.
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
    </project_instructions>
  `.trim();
}

// Intro for the <attached_folders> block listing a project's folders, so they
// carry the same mount-handling guidance as user-attached folders.
export function projectFoldersIntro(name: string): string {
  return `These folders belong to the "${name}" project and are available throughout this task.`;
}
