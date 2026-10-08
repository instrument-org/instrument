import { type SetupAnswers } from "@/client/components/onboarding/setup/flow";

/** The apps setup can save an import-memories prompt for, as the import names them. */
export const MEMORY_SOURCES = [
  { id: "chatgpt", name: "ChatGPT", site: "https://chatgpt.com" },
  { id: "claude", name: "Claude", site: "https://claude.ai" },
  { id: "gemini", name: "Gemini", site: "https://gemini.google.com" },
] as const;

/**
 * The words of each draft setup saves, in the order they are saved: one per
 * checked task, then one per app left on for importing memories. An import
 * opens on "Import my memories from <App>." so the draft is named for it,
 * followed by what the import in Settings asks after its own first line.
 */
export function setupDraftWords(
  answers: Pick<SetupAnswers, "memories" | "tasks">,
  importPrompt: (source: { name: string; site: string }) => string,
): string[] {
  const tasks = answers.tasks
    .filter((entry) => entry.checked)
    .map((entry) => entry.task.prompt);
  const imports = MEMORY_SOURCES.filter(
    (source) => answers.memories[source.id],
  ).map((source) => {
    const rest = importPrompt(source).split("\n\n").slice(1).join("\n\n");
    return [`Import my memories from ${source.name}.`, rest]
      .filter(Boolean)
      .join("\n\n");
  });
  return [...tasks, ...imports];
}
