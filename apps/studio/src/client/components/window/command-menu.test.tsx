import { renderWithProviders } from "@/tests/render";
import { installWindowStubs } from "@/tests/window-stubs";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCommandMenuRows } from "./command-menu";

vi.mock("@/client/hooks/use-developer-mode", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/client/hooks/use-developer-mode")
  >()),
  useDeveloperMode: () => true,
}));

// What a query answers, by its path; every other query stays pending.
const answers = new Map<string, unknown>();
vi.mock("@/client/rpc/client", () => {
  const pending = () => new Promise(() => undefined);
  const procedure = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      apply: pending,
      get(_target, key) {
        if (key === "queryOptions" || key === "experimental_liveOptions") {
          return () => ({
            queryFn: () =>
              answers.has(path.join("."))
                ? Promise.resolve(answers.get(path.join(".")))
                : pending(),
            queryKey: path,
          });
        }
        if (key === "mutationOptions") {
          return (options: object) => ({ mutationFn: pending, ...options });
        }
        return typeof key === "string" ? procedure([...path, key]) : undefined;
      },
    });
  return { rpcClient: procedure([]) };
});

vi.mock("@/client/components/window/shell-context", () => ({
  useShell: () => ({
    appTabs: { openNewTab: () => undefined },
    chats: [],
    goToPlace: () => undefined,
    newDraft: () => undefined,
    topics: [],
  }),
}));

vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({ setTheme: () => undefined, theme: "system" }),
}));

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(window, "electron", {
    configurable: true,
    value: { process: { platform } },
  });
}

/** The Settings tabs the menu finds for "settings", by their labels. */
function SettingsTabRows() {
  const { rows } = useCommandMenuRows({
    active: true,
    done: (run) => run,
    openPage: () => undefined,
    openScreen: () => undefined,
    surface: "dialog",
    words: "settings",
  });
  return (
    <ul>
      {rows.map((row) =>
        row.type === "item" && row.label.startsWith("Settings: ") ? (
          <li key={row.id}>{row.label}</li>
        ) : null,
      )}
    </ul>
  );
}

const listed = () =>
  screen
    .queryAllByRole("listitem")
    .map((item) => item.textContent)
    .sort();

afterEach(() => {
  installWindowStubs();
  answers.clear();
});

// The tabs the menu finds are the ones the Settings sidebar lists, so none
// opens a page the sidebar would not show.
describe("Settings tabs in the command menu in developer mode", () => {
  it.each([
    ["darwin", false],
    ["win32", false],
    ["linux", true],
  ] as const)("on %s lists Debug: %s", (platform, debug) => {
    setPlatform(platform);
    renderWithProviders(<SettingsTabRows />);

    expect(listed()).toEqual(
      [
        "Settings: Features",
        "Settings: Memory",
        "Settings: Permissions",
        "Settings: Providers",
        "Settings: Skills",
        "Settings: Storage",
        "Settings: Usage",
        ...(debug ? ["Settings: Debug"] : []),
      ].sort(),
    );
  });
});
