// Convert… opens a draft with the file picked and the ask started for the
// person to finish, and is left out wherever no draft can open.
import { renderWithProviders } from "@/tests/render";
import { installWindowStubs } from "@/tests/window-stubs";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WindowContext, type WindowContextValue } from "./context";
import { ConvertButton, convertWords } from "./convert-files";

const windowWith = (askAbout?: WindowContextValue["askAbout"]) =>
  ({
    ask: vi.fn(),
    ...(askAbout ? { askAbout } : {}),
    browser: null,
    chatId: ChatIdSchema.parse("2026-10-31-convert"),
    askAboutView: vi.fn(),
    openPage: vi.fn(),
    openPath: vi.fn(),
    openScreen: vi.fn(),
  }) satisfies WindowContextValue;

describe("Convert…", () => {
  beforeEach(() => {
    installWindowStubs();
  });

  it("opens a draft with the file picked and the ask started", () => {
    const askAbout = vi.fn();
    renderWithProviders(
      <WindowContext value={windowWith(askAbout)}>
        <ConvertButton hostPath="/Users/mac-user/Movies/demo-2019.avi" />
      </WindowContext>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Convert…" }));
    expect(askAbout.mock.calls).toMatchInlineSnapshot(`
      [
        [
          [
            {
              "kind": "file",
              "path": "/Users/mac-user/Movies/demo-2019.avi",
            },
          ],
          "Convert this to ",
        ],
      ]
    `);
  });

  it("is left out where no draft can open", () => {
    renderWithProviders(
      <WindowContext value={windowWith()}>
        <ConvertButton hostPath="/Users/mac-user/Movies/demo-2019.avi" />
      </WindowContext>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each([
    [1, "Convert this to "],
    [3, "Convert these to "],
  ])("starts the ask for %i file(s)", (count, words) => {
    expect(convertWords(count)).toBe(words);
  });
});
