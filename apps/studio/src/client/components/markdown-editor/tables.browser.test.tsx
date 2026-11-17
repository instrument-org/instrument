import {
  closeMarkdownEditors,
  openMarkdownEditor,
} from "@/tests/markdown-editor";
import { afterEach, expect, it, vi } from "vitest";

// See openMarkdownEditor; the links plugin asks which linked files are missing.
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    files: {
      missing: { call: () => Promise.resolve({ missing: [] }) },
    },
  },
}));

afterEach(closeMarkdownEditors);

const sentence =
  "Subscription quota counts toward the plan's usage and the five-hour window, and the person can cap it in settings.";

/** Five columns of sentences, the shape that used to wrap a word a line. */
const proseTable = [
  "| Kind | Fast model | Cost | Terms risk | Default |",
  "| --- | --- | --- | --- | --- |",
  `| Claude account | ${sentence} | ${sentence} | ${sentence} | On |`,
  `| ChatGPT account | ${sentence} | ${sentence} | ${sentence} | Off |`,
].join("\n");

/** Long code paths in a cell, the shape that used to scroll sideways. */
const pathTable = [
  "| Path | What it gives | Fit |",
  "|---|---|---|",
  "| `instrument window read` (`apps/studio/src/client/components/window/browser-tabs.tsx:670` via `apps/studio/src/client/lib/browser-pool.ts:1101`) | Body text plus a line per visible form field. | **The base to build on.** It is cheap and sees what the person sees. |",
  "| `history.db` (`apps/studio/src/electron-main/browser-view/history-store.ts:95`) | Titles and visits; the follow-up is `packages/workspace/src/lib/shell-commands/agent-browser-follow-up.ts`. | **Use for ranking.** |",
].join("\n");

const shortTable = ["| A | B |", "| - | - |", "| 1 | 2 |"].join("\n");

/** The editor as a document page draws it, with this much room past its
    column on the right (the harness column is 640px). */
async function openTable(markdown: string, roomEnd: number) {
  const view = await openMarkdownEditor(`Intro paragraph.\n\n${markdown}\n`);
  const frame = view.dom.closest<HTMLElement>(".md-editor")!;
  frame.style.setProperty("--page-room-end", `${roomEnd}px`);
  const block = view.dom.querySelector<HTMLElement>(".milkdown-table-block")!;
  await vi.waitFor(() => {
    expect(block.querySelector("table.children td")).not.toBeNull();
  });
  const table = block.querySelector<HTMLTableElement>("table.children")!;
  const wrapper = block.querySelector<HTMLElement>(".table-wrapper")!;
  const text = view.dom.querySelector("p")!.getBoundingClientRect();
  const columns = [...table.rows[0]!.cells].map(
    (cell) => cell.getBoundingClientRect().width,
  );
  return {
    block,
    columns,
    table: table.getBoundingClientRect(),
    text,
    wrapper,
  };
}

it("keeps a table's left edge on the text and grows it into the room", async () => {
  const { block, table, text } = await openTable(proseTable, 300);
  // Paint containment would clip the table to the text column.
  expect(getComputedStyle(block).contentVisibility).not.toBe("auto");
  expect(table.left).toBe(text.left);
  expect(table.width).toBeGreaterThan(text.width);
  expect(table.right).toBeLessThanOrEqual(text.right + 300);
});

it("never wraps a column of sentences narrower than its floor", async () => {
  const { columns } = await openTable(proseTable, 0);
  // 12em at the table's 14px, plus the cell's 24px of padding.
  for (const width of columns.slice(1, 4)) {
    expect(width).toBeGreaterThanOrEqual(12 * 14 + 24);
  }
});

it("scrolls rather than squeezing when the floors do not fit", async () => {
  const { wrapper } = await openTable(proseTable, 0);
  expect(wrapper.scrollWidth).toBeGreaterThan(wrapper.clientWidth);
});

it("breaks a long path instead of scrolling the table", async () => {
  const { wrapper } = await openTable(pathTable, 200);
  expect(wrapper.scrollWidth).toBe(wrapper.clientWidth);
});

it("spans the text column with a table of two short columns", async () => {
  const { table, text } = await openTable(shortTable, 300);
  expect(table.width).toBe(text.width);
});
