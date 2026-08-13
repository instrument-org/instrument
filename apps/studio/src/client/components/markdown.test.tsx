import { renderWithProviders } from "@/tests/render";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Markdown } from "./markdown";

// The chip navigates on click; the route tree it navigates within is not what
// these tests are about.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// A chip is drawn from its path, so nothing under `workspace` may be reached
// while rendering one. `utils` stays real enough for the external-link path,
// which is a different question and still needs the main process.
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    utils: {
      openExternalLink: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    },
    get workspace(): never {
      throw new Error("a rendering file link resolved a file over the network");
    },
  },
}));

const TASK_ID = TaskIdSchema.parse("a-task");
const ASSET_BASE = "http://assets.a-task.localhost:1234";

function renderMarkdown(markdown: string) {
  return renderWithProviders(
    <Markdown assetBaseUrl={ASSET_BASE} markdown={markdown} taskId={TASK_ID} />,
  );
}

describe("Markdown links", () => {
  it("opens a file: link to a shared folder, which the task file index never holds", () => {
    renderMarkdown(
      "Created [`August.md`](file:///mnt/Documents-Test%202/August.md) in Test 2.",
    );

    expect(screen.getByRole("button", { name: "August.md" }).title).toBe(
      "/mnt/Documents-Test 2/August.md",
    );
  });

  it("opens a task-relative link", () => {
    renderMarkdown("Wrote [`notes.md`](output/notes.md).");

    expect(screen.getByRole("button", { name: "notes.md" }).title).toBe(
      "output/notes.md",
    );
  });

  // Nothing checks whether the file is there, so this is a chip like any other
  // and the click is what reports the miss. Worth its own case because the
  // behavior it replaced was the opposite: a path matching no file rendered as
  // prose, which hid the fact that the reply had claimed a file at all.
  it("opens a link to a file that is not there", () => {
    renderMarkdown("Wrote [`gone.md`](output/gone.md).");

    expect(screen.getByRole("button", { name: "gone.md" })).toBeDefined();
  });

  // Asserted as the absence of an anchor rather than of a link role, which an
  // `<a>` carrying the empty href the default transform leaves behind does not
  // have either: the dead anchor is the whole bug, so a test that cannot see
  // one passes whether the href reaches the shell or not.
  it.each([
    ["a path outside the mounts", "file:///Users/someone/.ssh/id_rsa"],
    ["a traversal", "../../etc/passwd"],
  ])("leaves a link to %s as plain text", (_case, href) => {
    const { container } = renderMarkdown(`Saved [your key](${href}).`);

    expect(container.querySelector("a")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.textContent).toContain("your key");
  });

  it("leaves a file: URL that does not parse as plain text", () => {
    const { container } = renderMarkdown("See [the doc](file://host|bad/x).");

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("the doc");
  });

  it("still hands an http link to the browser", () => {
    renderMarkdown("See [the docs](https://example.com/a).");

    expect(screen.getByRole("link", { name: "the docs" })).toHaveProperty(
      "href",
      "https://example.com/a",
    );
  });
});

// What the transform does to a tree has its own tests; these are about the
// attribute surviving the trip through the rehype pipeline and out of
describe("Markdown images", () => {
  it("names the image that could not be drawn, rather than breaking", () => {
    renderMarkdown("![The chart](output/chart.png)");

    fireEvent.error(screen.getByRole("img"));

    expect(screen.getByText("The chart")).toBeTruthy();
    expect(screen.getByText(`${ASSET_BASE}/output/chart.png`)).toBeTruthy();
  });

  // A reply routinely names the file it is still writing, so mid-turn a miss
  // says nothing about whether the image will be there.
  it("says nothing of an image the reply has not finished writing", () => {
    renderWithProviders(
      <Markdown
        assetBaseUrl={ASSET_BASE}
        isStreaming
        markdown="![The chart](output/chart.png)"
        taskId={TASK_ID}
      />,
    );

    fireEvent.error(screen.getByRole("img"));

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("The chart")).toBeNull();
  });
});

// react-markdown under the name the stylesheet looks for.
describe("Markdown streaming words", () => {
  const streamingWords = (markdown: string) => {
    const { container } = renderWithProviders(
      <Markdown
        assetBaseUrl={ASSET_BASE}
        isStreaming
        markdown={markdown}
        taskId={TASK_ID}
      />,
    );
    return [...container.querySelectorAll("[data-stream-word]")].map(
      (word) => word.textContent,
    );
  };

  it("hands every word of streaming prose to the stylesheet", () => {
    expect(streamingWords("Reading the config")).toEqual([
      "Reading",
      "the",
      "config",
    ]);
  });

  it("leaves code alone, since the components under it read a string", () => {
    expect(streamingWords("Run `pnpm test run` first")).toEqual([
      "Run",
      "first",
    ]);
  });

  it("wraps nothing once the text has settled", () => {
    const { container } = renderMarkdown("Reading the config");

    expect(container.querySelectorAll("[data-stream-word]")).toHaveLength(0);
  });
});
