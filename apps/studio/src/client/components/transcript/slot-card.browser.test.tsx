import type * as ComputerFileUrl from "@/client/lib/computer-file-url";

import { renderInBrowser } from "@/tests/render-browser";
import { StoreId, type TurnStep } from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../theme-provider";
import { SlotCardView } from "./slot-card";
import { type TranscriptSurface, TranscriptSurfaceContext } from "./surface";

// A file's picture comes over the app protocol, which only the main process
// answers, so here it is an address named by the file.
vi.mock("@/client/lib/computer-file-url", async (importOriginal) => ({
  ...(await importOriginal<typeof ComputerFileUrl>()),
  getComputerThumbnailUrl: ({ hostPath }: { hostPath: string }) =>
    `https://pictures.test${hostPath}`,
}));

// Every path is where the call said it was, and nothing else is asked for.
const SURFACE: TranscriptSurface = {
  PagePicture: () => null,
  onOpenFile: () => undefined,
  onOpenTask: () => undefined,
  onOpenUrl: () => undefined,
  onStopCommand: () => undefined,
  onStopTask: () => undefined,
  useCommands: () => [],
  useDrivenPage: () => undefined,
  useHostPaths: (paths) =>
    Object.fromEntries(paths.map((path) => [path, path])),
  useStepPart: () => undefined,
  useTaskFacts: () => undefined,
  useTaskMessages: () => [],
};

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

async function renderSteps(kind: "files" | "images", steps: TurnStep[]) {
  return renderInBrowser(
    <ThemeProvider>
      <TranscriptSurfaceContext value={SURFACE}>
        <div style={{ width: 460 }}>
          <SlotCardView
            card={{ changedFile: undefined, kind, steps }}
            isCurrent
            sessionId={StoreId.newSessionId()}
          />
        </div>
      </TranscriptSurfaceContext>
    </ThemeProvider>,
  );
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
    const card = screen.container.querySelector("[data-slot-card]");
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
    const card = screen.container.querySelector("[data-slot-card]");
    expect(card?.querySelector("img")).not.toBeNull();
    expect(card?.textContent).not.toContain("Roasted");
  });
});

describe("a live card's pictures", () => {
  const read = (path: string) => step({ kind: "image", path }, "done");

  it("shows one picture alone", async () => {
    const screen = await renderSteps("images", [read("/work/a.png")]);
    expect(
      screen.container.querySelectorAll("[data-slot-card] img"),
    ).toHaveLength(1);
  });

  it("puts every picture along a strip under the newest, the newest ringed", async () => {
    const paths = Array.from(
      { length: 8 },
      (_, index) => `/work/${index.toString()}.png`,
    );
    const screen = await renderSteps("images", paths.map(read));
    const pictures = [
      ...screen.container.querySelectorAll("[data-slot-card] img"),
    ];
    // The newest large, then the strip of the last six, oldest first.
    expect(
      pictures.map((picture) =>
        picture.getAttribute("src")?.replace("https://pictures.test", ""),
      ),
    ).toEqual(["7", "2", "3", "4", "5", "6", "7"].map((n) => `/work/${n}.png`));
    expect(pictures.at(-1)?.className).toContain("ring-brand-500");
  });
});
