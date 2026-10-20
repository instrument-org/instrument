import {
  closeMarkdownEditors,
  openMarkdownEditor,
} from "@/tests/markdown-editor";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

// See openMarkdownEditor; the links plugin also asks which linked files are missing.
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    files: { missing: { call: () => Promise.resolve({ missing: [] }) } },
  },
}));

afterEach(closeMarkdownEditors);

it("opens a <details> written as one HTML block without blank lines between its tags", async () => {
  const view = await openMarkdownEditor(`<details>
<summary>Worked for 1s</summary>
<pre>
thinking: a short note.
</pre>
</details>
`);
  const summary = view.dom.querySelector("summary");
  if (!summary) {
    throw new Error("no summary drawn");
  }

  await userEvent.click(summary);

  const pre = view.dom.querySelector("pre");
  // Only the pre's own margin between them: the newlines between the tags
  // are HTML whitespace, not lines.
  const gap =
    (pre?.getBoundingClientRect().top ?? 0) -
    summary.getBoundingClientRect().bottom;
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(16);
});

it("keeps a code block's own background inside an open <details>", async () => {
  const view = await openMarkdownEditor(`\`\`\`sh
ls
\`\`\`

<details>
<summary>Worked for 1s</summary>

\`\`\`sh
ls -la
\`\`\`

</details>
`);
  const summary = view.dom.querySelector<HTMLElement>(".md-html-summary");
  if (!summary) {
    throw new Error("no summary drawn");
  }

  await userEvent.click(summary);

  const [outside, inside] = [
    ...view.dom.querySelectorAll<HTMLElement>(".milkdown-code-block"),
  ];
  expect(inside && getComputedStyle(inside).backgroundColor).toBe(
    outside && getComputedStyle(outside).backgroundColor,
  );
});
