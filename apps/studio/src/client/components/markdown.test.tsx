import {
  type ImageSourceKind,
  MARKDOWN_IMAGE_KINDS,
  UNTRUSTED_FILE_IMAGE_KINDS,
} from "@/client/lib/image-policy";
import { renderWithProviders } from "@/tests/render";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import { describe, expect, it, onTestFinished, vi } from "vitest";

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

// The first document in a run that carries HTML pays to load the parser behind
// `rehype-raw`, which is the largest thing this component fetches. Under a full
// suite that outlasts `waitFor`'s default, and the test reads the render from
// before the plugins arrived.
const RAW_HTML_TIMEOUT = 10_000;

const TASK_ID = TaskIdSchema.parse("a-task");
const ASSET_BASE = "http://assets.a-task.localhost:1234";

function renderMarkdown(markdown: string) {
  return renderWithProviders(
    <Markdown assetBaseUrl={ASSET_BASE} markdown={markdown} taskId={TASK_ID} />,
  );
}

/**
 * The preload bridge carrying the drag channel, which the shared stub leaves
 * off because it is optional and absent outside Electron. Without it the hook
 * correctly reports a surface as undraggable, which is what the sibling case
 * below asserts.
 */
function withFileDragBridge() {
  const api = window.api;
  Object.defineProperty(window, "api", {
    configurable: true,
    value: { ...api, startFileDrag: vi.fn() },
  });
  onTestFinished(() => {
    Object.defineProperty(window, "api", { configurable: true, value: api });
  });
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

  // The chip names a file on disk, so it is a handle for dragging that file out
  // to the desktop, the same as the file grid's cards and the pane's header.
  it("makes a chip for a task file draggable", () => {
    withFileDragBridge();
    renderMarkdown("Wrote [`notes.md`](output/notes.md).");

    expect(
      screen
        .getByRole("button", { name: "notes.md" })
        .getAttribute("draggable"),
    ).toBe("true");
  });

  // Reasoning and a previewed markdown file render without the ambient task, so
  // the same chip names a path belonging to nothing anyone could be handed.
  it("leaves a chip drawn outside a task undraggable", () => {
    renderWithProviders(
      <Markdown markdown="Wrote [`notes.md`](output/notes.md)." />,
    );

    expect(
      screen
        .getByRole("button", { name: "notes.md" })
        .getAttribute("draggable"),
    ).toBe("false");
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

    // The origin is inside the anchor rather than beside it, so it is part of
    // the link's name: a reader who cannot see the label is the one with the
    // least other way to know where it goes.
    expect(
      screen.getByRole("link", { name: /the docs.*example\.com/ }),
    ).toHaveProperty("href", "https://example.com/a");
  });

  it("says where a link goes when its label does not", () => {
    const { container } = renderMarkdown(
      "See [the docs](https://example.com/a).",
    );

    expect(container.textContent).toBe("See the docs (example.com).");
  });

  it("leaves a link alone when its label already names the origin", () => {
    const { container } = renderMarkdown(
      "See [example.com](https://example.com/a).",
    );

    expect(container.textContent).toBe("See example.com.");
  });

  it("draws an address as a chip rather than an origin", () => {
    renderMarkdown(
      "Send it to [neil@finalpoint.co](mailto:neil@finalpoint.co).",
    );

    expect(
      screen.getByRole("link", { name: "neil@finalpoint.co" }),
    ).toHaveProperty("href", "mailto:neil@finalpoint.co");
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
    const { container } = renderMarkdown("![The chart](output/chart.png)");

    fireEvent.error(screen.getByRole("img"));

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("The chart")).toBeTruthy();
    expect(screen.getByText("assets.a-task.localhost")).toBeTruthy();
    // A failed image is a fact rather than an offer, so the chip is no button.
    expect(screen.queryByRole("button", { name: /The chart/ })).toBeNull();
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

// A long document navigates by linking its own headings, which is the only
// intra-document navigation Markdown itself can express -- and the reason an
// author does not have to hand-write anchor targets to get one.
describe("Markdown heading anchors", () => {
  // jsdom has no scrolling, so what a click can be asked is which element the
  // hook resolved the fragment to. Which is the whole question: the lookup is
  // what a heading named `0700` breaks, an id selector being unable to start
  // with a digit.
  const clickThrough = (name: string) => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this);
    };
    fireEvent.click(screen.getByRole("link", { name }));
    return scrolled[0];
  };

  it("names a heading after its own text", () => {
    const { container } = renderMarkdown("## Slide map\n\nWhat follows.");

    expect(container.querySelector("h2")?.id).toBe("slide-map");
  });

  it("reaches a heading whose name is all digits", () => {
    const { container } = renderMarkdown(
      "[07:00](#0700)\n\n### 07:00\n\nWhat was said.",
    );

    expect(clickThrough("07:00")).toBe(container.querySelector("h3"));
  });

  it("reaches a target written as raw HTML under the name its author wrote", async () => {
    const { container } = renderMarkdown(
      '[jump](#t-420)\n\n<a id="t-420"></a>\n\n### 07:00',
    );

    // The sanitize pass rewrites the id, so the link and its target only meet
    // once that has happened.
    await waitFor(
      () => {
        expect(container.querySelector("#user-content-t-420")).not.toBeNull();
      },
      { timeout: RAW_HTML_TIMEOUT },
    );

    expect(clickThrough("jump")).toBe(
      container.querySelector("#user-content-t-420"),
    );
  });
});

// HTML inside a Markdown document is drawn rather than printed, which is what a
// collapsible section, a README's sized screenshot, and GitHub's image
// attachments all depend on. None of that markup is ours -- a model wrote it,
// or it arrived in a download or a shared folder -- so what renders is an
// allow-list and everything outside it is dropped.
describe("Markdown raw HTML", () => {
  // The parser that draws it is fetched on demand, and until it lands the
  // document renders with its markup printed as text. Every case here is about
  // what the second render says, so each one waits for the source to stop
  // showing rather than asserting over whichever render it caught.
  const renderDrawn = async (markdown: string) => {
    const { container } = renderMarkdown(markdown);
    await waitFor(
      () => {
        expect(container.textContent).not.toContain("<");
      },
      { timeout: RAW_HTML_TIMEOUT },
    );
    return container;
  };

  it("draws a construct Markdown has no syntax for", async () => {
    const container = await renderDrawn(
      "<details><summary>More</summary>\n\nHidden.\n\n</details>",
    );

    expect(container.querySelector("details > summary")?.textContent).toBe(
      "More",
    );
  });

  it.each([
    ["a script", "<div><script>globalThis.owned = true</script></div>"],
    ["a frame", '<div><iframe src="https://example.com"></iframe></div>'],
    ["an inline style", '<p style="position:fixed;inset:0">text</p>'],
  ])("drops %s", async (_case, html) => {
    const container = await renderDrawn(html);

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("[style]")).toBeNull();
  });

  // A model spells a link to a file it just wrote as a `file:` URL, which the
  // allow-list a browser would apply does not know as a scheme.
  it("still opens a file: link in a document that holds HTML", async () => {
    await renderDrawn(
      "<p>Note.</p>\n\nWrote [`notes.md`](file:///mnt/Shared/notes.md).",
    );

    expect(screen.getByRole("button", { name: "notes.md" }).title).toBe(
      "/mnt/Shared/notes.md",
    );
  });

  // Turning the parser on for prose that merely holds angle brackets would cost
  // the word between them, an unknown tag being unwrapped rather than shown.
  it("leaves a type parameter in prose as the text it is", () => {
    const { container } = renderMarkdown("It returns Array<string> here.");

    expect(container.textContent).toContain("Array<string>");
  });

  // A model that ends a line with `<br>` has written the break the newline
  // after it already stands for, and honoring both leaves a blank line above
  // whatever comes next. The `kbd` is the gate: it is drawn only once the
  // parser has landed, which is also when the `br` this counts exists.
  it("reads a break written as HTML and the newline after it as one break", async () => {
    const { container } = renderMarkdown(
      "Press <kbd>K</kbd>:<br>\n![The chart](output/chart.png)",
    );

    await waitFor(
      () => {
        expect(container.querySelector("kbd")).toBeTruthy();
      },
      { timeout: RAW_HTML_TIMEOUT },
    );

    expect(container.querySelectorAll("br")).toHaveLength(1);
  });

  // The sanitize pass runs over the whole document rather than only the markup
  // it re-parsed, so a document that holds any HTML at all is one where the
  // pass decides what an ordinary `![](...)` may point at. A notebook markdown
  // cell is both at once: its attachments arrive as `data:` URIs, and a `<br>`
  // or a `<div align>` beside them is the ordinary way such a cell is written.
  it("keeps an embedded image in a document that also holds HTML", async () => {
    const container = await renderDrawn(
      "<details><summary>More</summary></details>\n\n![a](data:image/png;base64,QUJD)",
    );

    expect(
      [...container.querySelectorAll("img")].map((image) =>
        image.getAttribute("src"),
      ),
    ).toEqual(["data:image/png;base64,QUJD"]);
  });

  // A `<picture>` names an image a second way, and its `<source srcset>` is
  // fetched exactly as an `<img src>` is while being no `src` at all: the image
  // policy is asked about the `src` of an `<img>` and never sees it. So the tag
  // allow-list is where the second way closes, leaving the `<img>` that the
  // `<picture>` wrapped as the source that gets judged.
  it("drops a responsive source beside an image", async () => {
    const container = await renderDrawn(
      '<picture><source srcset="https://tracker.test/beacon.png"><img src="data:image/png;base64,QUJD"></picture>',
    );

    expect(container.querySelector("source")).toBeNull();
    expect(container.querySelector("[srcset]")).toBeNull();
    expect(
      [...container.querySelectorAll("img")].map((image) =>
        image.getAttribute("src"),
      ),
    ).toEqual(["data:image/png;base64,QUJD"]);
  });

  // The widened `src` reaches an image and stops there. Every element that
  // could execute what a `data:` URI carries is dropped whole by the tag
  // allow-list, so the two answers cannot drift apart.
  it("drops an embedded source on anything that is not an image", async () => {
    const container = await renderDrawn(
      '<p>Text.</p><iframe src="data:text/html,<b>hi</b>"></iframe>',
    );

    expect(container.querySelector("iframe")).toBeNull();
  });

  // A blank line is the one thing a doubled break is good for, so a document
  // that opens one on purpose keeps it.
  it("keeps a blank line written as two breaks", async () => {
    const { container } = renderMarkdown("Above.<br><br>Below.");

    await waitFor(
      () => {
        expect(container.querySelectorAll("br").length).toBeGreaterThan(0);
      },
      { timeout: RAW_HTML_TIMEOUT },
    );

    expect(container.querySelectorAll("br")).toHaveLength(2);
  });
});

/**
 * Which image sources reach the page.
 *
 * Markdown arrives from three places that are not the person reading it -- the
 * agent, a `.md` file in the task folder, and a cell of a notebook someone else
 * wrote -- and an `<img>` is fetched the moment it renders, with no click in
 * between. So what the allow-list admits is a question about the network, not
 * about layout, which is what makes it worth a test rather than an eye.
 */
function imageSources(
  markdown: string,
  imageKinds: readonly ImageSourceKind[] = MARKDOWN_IMAGE_KINDS,
): string[] {
  const { container } = renderWithProviders(
    <Markdown imageKinds={imageKinds} markdown={markdown} />,
  );
  return [...container.querySelectorAll("img")]
    .map((image) => image.getAttribute("src"))
    .filter((src) => src !== null);
}

describe("Markdown image sources", () => {
  it("renders an embedded image", () => {
    expect(imageSources("![a](data:image/png;base64,QUJD)")).toEqual([
      "data:image/png;base64,QUJD",
    ]);
  });

  // A bare `output/plot.png` is deliberately not here: without an
  // `assetBaseUrl` there is nothing to resolve it against, so it stays a bare
  // word and the allow-list rejects it. Only an explicit `./` or `/` reads as
  // a path on sight.
  it("renders a path relative to the task", () => {
    expect(imageSources("![a](./output/plot.png)")).toEqual([
      "./output/plot.png",
    ]);
  });

  it("renders an image from an allowed host", () => {
    expect(
      imageSources("![a](https://raw.githubusercontent.com/o/r/main/p.png)"),
    ).toEqual(["https://raw.githubusercontent.com/o/r/main/p.png"]);
  });

  it("drops an image from a host that is not on the list", () => {
    expect(imageSources("![a](https://tracker.test/pixel.png)")).toEqual([]);
  });

  // An allowed host is a host, not a string that appears somewhere in the URL.
  // Every case here names `githubusercontent.com` or `.localhost` somewhere a
  // reader's eye skips -- a path segment, a query, a fragment -- and each one
  // is a request to a host of the author's choosing.
  it.each([
    ["a path segment", "https://evil.test/x.githubusercontent.com/p.png"],
    ["a deeper path segment", "https://evil.test/a/b.github.com/p.png"],
    ["a query", "https://evil.test?a=.githubusercontent.com/p.png"],
    ["a fragment", "https://evil.test#.githubusercontent.com/p.png"],
    ["an http path segment", "http://evil.test/x.localhost/p.png"],
  ])("drops an allowed host named only in %s", (_case, src) => {
    expect(imageSources(`![a](${src})`)).toEqual([]);
  });

  // The suffix match is against the host's own end, so a domain that merely
  // opens with an allowed one is a different host and stays off.
  it("drops a host that only starts with an allowed one", () => {
    expect(
      imageSources("![a](https://x.githubusercontent.com.evil.test/p.png)"),
    ).toEqual([]);
  });

  // A notebook markdown cell is the case: a file someone else wrote, whose own
  // pictures arrive as attachments and so as bytes. Anything else there names
  // something to fetch, and opening the file is the fetch.
  describe("in a file someone else wrote", () => {
    it("still renders an embedded one", () => {
      expect(
        imageSources(
          "![a](data:image/png;base64,QUJD)",
          UNTRUSTED_FILE_IMAGE_KINDS,
        ),
      ).toEqual(["data:image/png;base64,QUJD"]);
    });

    it.each([
      [
        "a host the agent would be trusted with",
        "https://github.com/o/r/p.png",
      ],
      // Plain http on a `.localhost` host is the task asset origin, which is
      // every port on this machine as far as the host tells. A file that
      // belongs to no task has nothing to address there, so what such a source
      // reaches is whatever else is listening.
      ["a loopback service", "http://x.localhost:11434/api/pull?name=evil"],
      ["a path inside a task", "./output/plot.png"],
    ])("drops %s", (_case, src) => {
      expect(imageSources(`![a](${src})`, UNTRUSTED_FILE_IMAGE_KINDS)).toEqual(
        [],
      );
    });
  });

  // The allow-list names an image type rather than taking the `data:` scheme
  // whole, so the widest thing markdown from anywhere can put in an `<img>` is
  // bytes a decoder will either read as a picture or refuse.
  it("drops an embedded uri that is not an image", () => {
    expect(imageSources("![a](data:text/html;base64,PGI+aGk8L2I+)")).toEqual(
      [],
    );
  });

  // `data:` reaches an `<img>` only because `markdownUrlTransform` hands it
  // back, and it hands it back for `<img>` alone. A link is the case that
  // separates the two: clicking one passes the URI to the OS, so it stays on
  // the floor where react-markdown's own filter left it.
  it("does not let an embedded uri through as a link", () => {
    const { container } = renderWithProviders(
      <Markdown markdown="[a](data:text/html,<b>hi</b>)" />,
    );
    expect(container.querySelector('a[href^="data:"]')).toBeNull();
  });

  it.each([
    ["markdown written for this reader", MARKDOWN_IMAGE_KINDS],
    ["a file someone else wrote", UNTRUSTED_FILE_IMAGE_KINDS],
  ])("drops a protocol-relative source in %s", (_case, imageKinds) => {
    // The leading slash reads as a path on this machine, so without a check of
    // its own `//host/pixel.png` walks past every kind -- the one spelling of a
    // src that can name any host at all.
    expect(imageSources("![a](//tracker.test/pixel.png)", imageKinds)).toEqual(
      [],
    );
  });
});

// react-markdown's sync component re-parses the whole document on every
// render, so a render is a parse. The plugin effect must therefore leave the
// state of a document that needs no optional bundle exactly where the mount
// put it: a fresh-but-identical array there defeats React's Object.is bailout,
// and every plain message in a transcript parses twice.
describe("Markdown plugin loading", () => {
  it("commits a document that needs no optional plugin exactly once", async () => {
    let commits = 0;
    renderWithProviders(
      <Profiler
        id="markdown"
        onRender={() => {
          commits += 1;
        }}
      >
        <Markdown markdown="Plain prose with **emphasis** and nothing else." />
      </Profiler>,
    );

    // Room for the re-render the effect would schedule, were it to schedule
    // one.
    await act(async () => {
      await Promise.resolve();
    });

    expect(commits).toBe(1);
  });
});
