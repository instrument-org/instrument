import { renderWithProviders } from "@/tests/render";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Markdown } from "./markdown";

// The chip navigates on click and the file grid reads the task it is drawn in
// from the route; the route tree itself is not what these tests are about.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

// The grid a ```files fence resolves to is a router-bound tree of preview cards
// with its own tests. All that is being asked here is which component the fence
// reached.
vi.mock("./files-grid", () => ({
  FilesGrid: ({ files }: { files: { filePath: string }[] }) => (
    <ul>
      {files.map((file) => (
        <li key={file.filePath}>{file.filePath}</li>
      ))}
    </ul>
  ),
}));

// A chip is drawn from its path, so nothing under `workspace` may be reached
// while rendering one. `utils` stays real enough for the external-link path,
// which is a different question and still needs the main process.
// A code block asks which theme to highlight against, and the real provider
// answers through `matchMedia` and an RPC round trip, neither of which is here.
vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    // No language is supported here, so every block renders as the plain text
    // it falls back to while the highlighter is still being asked. What the
    // highlighted markup does with the same classes is a browser test.
    syntax: {
      highlightCode: {
        queryOptions: () => ({ queryFn: () => [], queryKey: ["highlight"] }),
      },
      supportedLanguages: {
        queryOptions: () => ({ queryFn: () => [], queryKey: ["languages"] }),
      },
    },
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

// A fence is reached through its `pre`, because that is the only element that
// knows it is one. Reached through `code`, a fence with no language was
// indistinguishable from inline code and rendered as it: one line of collapsed
// whitespace, wearing the backticks prose draws around an inline span.
describe("Markdown fences", () => {
  const fenceIn = (container: HTMLElement) => {
    const pre = container.querySelector("pre");
    if (!pre) {
      throw new Error("the fence did not render as a block");
    }
    return pre;
  };

  it.each([
    ["no language", "```\nfirst\n\nsecond\n```"],
    ["a language", "```ts\nfirst\n\nsecond\n```"],
    ["indentation instead of a fence", "    first\n\n    second"],
  ])("keeps the line structure of a block with %s", (_case, markdown) => {
    const { container } = renderMarkdown(markdown);

    expect(fenceIn(container).textContent).toBe("first\n\nsecond");
  });

  it("offers the same controls whether or not the fence names a language", () => {
    const { container } = renderMarkdown("```\ncat log.txt\n```");

    expect(
      [...container.querySelectorAll("button")].map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["Wrap lines", "Copy"]);
  });

  it("wraps by default, and remembers nothing once toggled off", () => {
    const { container, unmount } = renderMarkdown("```\ncat log.txt\n```");
    const toggle = screen.getByRole("button", { name: "Wrap lines" });

    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(fenceIn(container).className).toBe("");

    unmount();
    renderMarkdown("```\ncat log.txt\n```");
    expect(
      screen
        .getByRole("button", { name: "Wrap lines" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it.each([
    ["a bare path", "```ts src/foo.ts"],
    ["a title", '```ts title="src/foo.ts"'],
    ["the language slot", "```ts:src/foo.ts"],
  ])("labels a fence that names its file with %s", (_case, opening) => {
    renderMarkdown(`${opening}\nconst a = 1;\n\`\`\``);

    expect(screen.getByText("src/foo.ts")).toBeTruthy();
  });

  // The rest of an info string is a directive to some other renderer -- line
  // ranges, flags -- and naming no file it has no business labeling the block.
  it.each([
    ["a line range", "{1,3}"],
    ["a flag", "showLineNumbers"],
  ])("leaves a fence carrying %s labeled by its language", (_case, meta) => {
    renderMarkdown(`\`\`\`ts ${meta}\nconst a = 1;\n\`\`\``);

    expect(screen.getByText("TypeScript")).toBeTruthy();
  });

  // Whatever a model types in the info string is as likely to be an extension
  // or an alias as a language id, and none of the three is what a person calls
  // the language.
  it.each([
    ["ts", "TypeScript"],
    ["sh", "Shell"],
    ["yml", "YAML"],
    ["cpp", "C++"],
    ["rust", "Rust"],
  ])("writes out the language a ```%s fence names as %s", (fence, name) => {
    renderMarkdown(`\`\`\`${fence}\nx\n\`\`\``);

    expect(screen.getByText(name)).toBeTruthy();
  });

  it("labels a fence that names no language with nothing at all", () => {
    const { container } = renderMarkdown("```\ncat log.txt\n```");

    expect(container.textContent).toBe("cat log.txt");
  });

  // The fence every reply that names a file ends in, which is not code and is
  // not drawn as any of it.
  it("hands a ```files fence to the grid that draws a reply's files", () => {
    const { container } = renderMarkdown("```files\noutput/report.pdf\n```");

    expect(container.querySelector("pre")).toBeNull();
    expect(screen.getByText("output/report.pdf")).toBeTruthy();
  });

  // A mermaid fence *is* a code block until its diagram parses, and here it
  // never does. What says it was dispatched is the toolbar it came back with:
  // the diagram's, which has no wrapping to offer.
  it("hands a ```mermaid fence to the diagram it draws", () => {
    const { container } = renderMarkdown(
      "```mermaid\ngraph TD\n  A --> B\n```",
    );

    expect(
      [...container.querySelectorAll("button")].map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["Copy"]);
  });

  it("holds a block past the collapse threshold back until asked", () => {
    const lines = (count: number) =>
      `\`\`\`\n${Array.from({ length: count }, (_, index) => `line ${index}`).join("\n")}\n\`\`\``;

    renderMarkdown(lines(24));
    expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull();

    renderMarkdown(lines(25));
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
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
