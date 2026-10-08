import { describe, expect, it } from "vitest";

import { setupDraftWords } from "./tasks-drafts";

const task = (prompt: string) => ({ detail: "", icon: "list", prompt });

describe("setupDraftWords", () => {
  it("saves checked tasks, then an import per app left on", () => {
    expect(
      setupDraftWords(
        {
          memories: { chatgpt: true, claude: false, gemini: true },
          tasks: [
            { checked: true, task: task("Plan two weeks of posts.") },
            { checked: false, task: task("Summarize my sales.") },
          ],
        },
        ({ name, site }) => `Import what ${name} knows.\n\nOpen ${site}.`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "Plan two weeks of posts.",
        "Import my memories from ChatGPT.

      Open https://chatgpt.com.",
        "Import my memories from Gemini.

      Open https://gemini.google.com.",
      ]
    `);
  });

  it("saves nothing when nothing is picked", () => {
    expect(
      setupDraftWords(
        {
          memories: { chatgpt: false, claude: false, gemini: false },
          tasks: [],
        },
        () => "",
      ),
    ).toEqual([]);
  });
});
