import type * as ComputerFileUrl from "@/client/lib/computer-file-url";

import { renderInBrowser } from "@/tests/render-browser";
import { transcriptRecords } from "@/tests/transcript-records";
import { StoreId, type TurnStep } from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../theme-provider";
import { WorkCardView } from "./work-card";
import { TranscriptRecordsContext } from "./transcript-data";

// A file's picture comes over the app protocol, which only the main process
// answers, so here it is a picture naming the file, and one that fails to
// load for a file under `/broken/`.
vi.mock("@/client/lib/computer-file-url", async (importOriginal) => ({
  ...(await importOriginal<typeof ComputerFileUrl>()),
  getComputerThumbnailUrl: ({
    hostPath,
    version,
  }: {
    hostPath: string;
    version?: number;
  }) =>
    hostPath.startsWith("/broken/")
      ? `data:image/png;base64,AAAA#${hostPath}`
      : `data:image/svg+xml,${encodeURIComponent(
          "<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/>",
        )}#${hostPath}${version === undefined ? "" : `@${version.toString()}`}`,
}));

/** The file a picture on the card is of, from its address. */
const pictured = (picture: Element) =>
  picture.getAttribute("src")?.replace(/^.*#/, "");

// Every path is where the call said it was, and nothing else is asked for.
const RECORDS = transcriptRecords();

// Whether Markdown came out as Markdown and code in its colors is a question
// about what the browser drew, which jsdom answers for any markup at all.

function writing(path: string, words: string): TurnStep {
  return step({ kind: "file", path, words }, "writing");
}

function step(shows: TurnStep["shows"], status: TurnStep["status"]): TurnStep {
  return {
    metadata: {
      createdAt: new Date("2026-01-01T00:00:00Z"),
      id: StoreId.newPartId(),
      messageId: StoreId.newMessageId(),
      sessionId: StoreId.newSessionId(),
    },
    shows,
    status,
    tool: "tool-write_file",
    type: "step",
  };
}

async function renderCard(path: string, words: string) {
  return renderStep(writing(path, words));
}

async function renderStep(shown: TurnStep) {
  return renderSteps("files", [shown]);
}

const SESSION = StoreId.newSessionId();

function cardOf(kind: "files" | "images", steps: TurnStep[]) {
  return (
    <ThemeProvider>
      <TranscriptRecordsContext value={RECORDS}>
        <div style={{ width: 460 }}>
          <WorkCardView
            card={{ changedFile: undefined, kind, steps }}
            isCurrent
            sessionId={SESSION}
          />
        </div>
      </TranscriptRecordsContext>
    </ThemeProvider>
  );
}

async function renderSteps(kind: "files" | "images", steps: TurnStep[]) {
  return renderInBrowser(cardOf(kind, steps));
}

describe("a live card's file as it is written", () => {
  it("shows Markdown as it reads, with nothing in it to press", async () => {
    const screen = await renderCard(
      "/work/report.md",
      "- **Obsidian for Agents.** See [Thread](https://example.com).",
    );
    await expect
      .element(screen.getByText("Obsidian for Agents."))
      .toBeVisible();
    const card = screen.container.querySelector("[data-work-card]");
    expect(card?.querySelector("strong")?.textContent).toBe(
      "Obsidian for Agents.",
    );
    expect(card?.textContent).not.toContain("**");
    expect(card?.querySelector("[inert] a")).not.toBeNull();
  });

  it("shows code in its colors", async () => {
    const screen = await renderCard(
      "/work/raw.json",
      '[{"q": ["website"], "count": 2}]',
    );
    await expect
      .poll(() =>
        screen.container.querySelector(".code-highlight .syntax-string"),
      )
      .not.toBeNull();
  });

  it("shows both sides of an edit to code in its colors", async () => {
    const screen = await renderStep(
      step(
        {
          after: 'const name = "new";',
          before: 'const name = "old";',
          kind: "file",
          path: "/work/a.ts",
        },
        "done",
      ),
    );
    await expect
      .poll(
        () =>
          screen.container.querySelectorAll(".code-highlight .syntax-string")
            .length,
      )
      .toBe(2);
  });

  it("shows a file with no grammar as typed", async () => {
    const screen = await renderCard("/work/notes.txt", "**not bold**");
    await expect.element(screen.getByText("**not bold**")).toBeVisible();
  });

  it("shows a finished page as its picture", async () => {
    const screen = await renderStep(
      step(
        {
          kind: "file",
          modifiedAt: 1,
          path: "/work/index.html",
          words: "<h1>Roasted on the coast</h1>",
        },
        "done",
      ),
    );
    const card = screen.container.querySelector("[data-work-card]");
    await expect.poll(() => card?.querySelector("img")).not.toBeNull();
    expect(card?.textContent).not.toContain("Roasted");
  });
});

describe("a live card's pictures", () => {
  const read = (path: string) => step({ kind: "image", path }, "done");

  it("shows one picture alone", async () => {
    const screen = await renderSteps("images", [read("/work/a.png")]);
    await expect
      .poll(
        () => screen.container.querySelectorAll("[data-work-card] img").length,
      )
      .toBe(1);
  });

  it("shows no picture that failed to load", async () => {
    const screen = await renderSteps("images", [read("/broken/a.png")]);
    // The picture that loads is the sign the broken one had its chance too.
    await renderSteps("images", [read("/work/b.png")]);
    await expect
      .poll(() => document.querySelectorAll("[data-work-card] img").length)
      .toBe(1);
    expect(screen.container.querySelector("img")).toBeNull();
  });

  it("keeps a picture up until its new version has loaded", async () => {
    const version = (modifiedAt: number) =>
      step({ kind: "image", modifiedAt, path: "/work/a.png" }, "done");
    const screen = await renderSteps("images", [version(1)]);
    const picture = () =>
      screen.container.querySelector<HTMLImageElement>("[data-work-card] img");
    await expect.poll(() => picture()).not.toBeNull();
    // Whether the card shows a whole picture each time anything in it changes.
    const seen: boolean[] = [];
    const observer = new MutationObserver(() => {
      const shown = picture();
      seen.push(shown !== null && shown.complete && shown.naturalWidth > 0);
    });
    observer.observe(screen.container, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    await screen.rerender(cardOf("images", [version(2)]));
    await expect
      .poll(() => {
        const shown = picture();
        return shown && pictured(shown);
      })
      .toBe("/work/a.png@2");
    observer.disconnect();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).not.toContain(false);
  });

  it("puts every picture along a strip under the newest, the newest ringed", async () => {
    const paths = Array.from(
      { length: 8 },
      (_, index) => `/work/${index.toString()}.png`,
    );
    const screen = await renderSteps("images", paths.map(read));
    await expect
      .poll(
        () => screen.container.querySelectorAll("[data-work-card] img").length,
      )
      .toBe(7);
    const pictures = [
      ...screen.container.querySelectorAll("[data-work-card] img"),
    ];
    // The newest large, then the strip of the last six, oldest first.
    expect(pictures.map((picture) => pictured(picture))).toEqual(
      ["7", "2", "3", "4", "5", "6", "7"].map((n) => `/work/${n}.png`),
    );
    expect(pictures.at(-1)?.className).toContain("ring-brand-500");
  });
});
