// The strip's cells give way by container width (`STRIP_TIER`). The widths are
// sized for the longest text each cell takes, which is Windows', so this
// sweeps the strip across window widths with that text in it.
import { atom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderInBrowser } from "../../../tests/render-browser";
import { installWindowStubs } from "../../../tests/window-stubs";
import { DeveloperStrip } from "./developer-strip";

/** What each query answers, by its path under `rpcClient`. */
const ANSWERS: Record<string, unknown> = {
  "debug.getAppEnvironment": {
    debugPort: 9333,
    drivePurpose: "strip-widths-with-a-long-purpose",
    isPackaged: true,
    userDataPath: "C:\\Users\\windows-user\\AppData\\Roaming\\Instrument",
  },
  "preferences.getAppVersion": { version: "2.1.0-beta.12" },
  "preferences.platformApiServer": { label: "Staging" },
  "utils.live.exceptions": { total: 12, version: 1 },
  "workspaces.current": { name: "A rather long workspace name", pinned: false },
};

/** Any `rpcClient` path, answering queries from `ANSWERS` and doing nothing else. */
function rpcPath(path: string[]): unknown {
  const options = () => ({
    queryFn: () => ANSWERS[path.join(".")] ?? null,
    queryKey: path,
  });
  const end: Record<string, unknown> = {
    call: () => Promise.resolve((async function* () {})()),
    experimental_liveOptions: options,
    mutationOptions: () => ({ mutationFn: () => Promise.resolve() }),
    queryOptions: options,
  };
  return new Proxy(end, {
    get: (target, key) =>
      typeof key === "string" && key in target
        ? target[key]
        : rpcPath([...path, String(key)]),
  });
}

vi.mock("@/client/rpc/client", () => ({ rpcClient: rpcPath([]) }));

vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({
    resolvedTheme: "dark",
    setTheme: () => {},
    theme: "dark",
  }),
}));

vi.mock("@/client/components/setup/use-setup-state", () => ({
  useFinishSetup: () => () => {},
  useIsSetupUp: () => false,
  useSetupState: () => undefined,
}));

vi.mock("@/client/components/captures/capture-store", () => ({
  openCaptureEditor: () => {},
  requestCapture: () => {},
  trashCapture: () => Promise.resolve(),
  useCaptures: () => Array.from({ length: 12 }, (_, index) => ({ index })),
}));

// A chat in the selected tab, so the chat notes cell is there.
vi.mock(
  "@/client/components/window/app-tabs",
  async (importOriginal: () => Promise<Record<string, unknown>>) => ({
    ...(await importOriginal()),
    appTabsAtom: atom({
      selectedId: "chat",
      tabs: [{ id: "chat", pathname: "/chats/chat" }],
    }),
  }),
);

beforeEach(() => {
  Object.defineProperty(window, "electron", {
    configurable: true,
    value: { process: { platform: "win32" } },
  });
});
afterEach(() => {
  installWindowStubs();
});

describe("DeveloperStrip", () => {
  it("never overlaps or clips a cell from 360px to 1600px wide on Windows", async () => {
    const screen = await renderInBrowser(
      <div data-testid="window">
        <DeveloperStrip onOpenDebugPages={() => {}} />
      </div>,
    );
    await expect
      .element(screen.getByRole("button", { name: "12 errors" }))
      .toBeVisible();
    const frame = screen.getByTestId("window").element() as HTMLElement;
    const strip = frame.querySelector<HTMLElement>("[data-developer-strip]");
    if (!strip) {
      throw new Error("No strip");
    }

    const problems: string[] = [];
    for (let width = 360; width <= 1600; width += 8) {
      frame.style.width = `${width}px`;
      const cells = [...strip.children].filter(
        (cell): cell is HTMLElement =>
          cell instanceof HTMLElement && cell.getBoundingClientRect().width > 0,
      );
      const [build, ...rest] = cells;
      if (!build) {
        throw new Error("No build cell");
      }
      // Every cell but the build's keeps its whole text.
      for (const cell of rest) {
        if (cell.scrollWidth > cell.clientWidth) {
          problems.push(`${width}px: "${cell.textContent}" is cut off`);
        }
      }
      // Cells sit side by side inside the strip.
      const stripBox = strip.getBoundingClientRect();
      for (const [index, cell] of cells.entries()) {
        const box = cell.getBoundingClientRect();
        const before = cells[index - 1]?.getBoundingClientRect();
        if (before && box.left < before.right - 0.5) {
          problems.push(
            `${width}px: "${cell.textContent}" overlaps its neighbor`,
          );
        }
        if (box.right > stripBox.right + 0.5) {
          problems.push(`${width}px: "${cell.textContent}" runs past the edge`);
        }
      }
      // The build cell always shows which environment this is.
      const env = build.firstElementChild?.getBoundingClientRect();
      if (!env || env.right > build.getBoundingClientRect().right + 0.5) {
        problems.push(`${width}px: the environment is cut off`);
      }
    }
    expect(problems).toEqual([]);
  });
});
