import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppsHome, CatalogTile } from "./apps-home";

vi.mock("@/client/hooks/use-open-external-link", () => ({
  useOpenExternalLink: () => () => undefined,
}));
const served = vi.hoisted(() => ({
  ask: vi.fn(),
  apps: [] as unknown[],
  catalog: [] as unknown[],
}));
vi.mock("@/client/rpc/client", () => {
  const live = (key: string, read: () => unknown) => ({
    experimental_liveOptions: () => ({ queryFn: read, queryKey: [key] }),
  });
  return {
    rpcClient: {
      apps: {
        catalogByMeaning: {
          queryOptions: () => ({
            enabled: false,
            queryFn: () => [],
            queryKey: ["meaning"],
          }),
        },
        live: {
          catalog: live("catalog", () => served.catalog),
          list: live("list", () => ({ apps: served.apps, invalid: [] })),
        },
      },
    },
  };
});
const { pressShortcut } = vi.hoisted(() => ({ pressShortcut: vi.fn() }));
vi.mock("@/client/components/window/drag/press-bookmark", () => ({
  pressShortcut,
}));
vi.mock("@/client/hooks/use-decision", () => ({
  useDecisionModelAvailable: () => false,
}));
vi.mock("@/client/components/window/context", () => ({
  useWindow: () => ({ ask: served.ask }),
}));
vi.mock("@/client/components/window/use-connect-from-directory", () => ({
  useConnectFromDirectory: () => ({ connect: vi.fn() }),
}));
vi.mock("@/client/components/window/app-menu", () => ({
  AppContextMenu: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/client/hooks/use-open-target", () => ({
  useOpenGestures: () => ({
    destinations: [],
    onContextMenu: () => undefined,
    opening: (onClick: () => void) => ({ onClick }),
  }),
}));

const figma: Parameters<typeof CatalogTile>[0]["entry"] = {
  authMethods: [],
  category: "design",
  description: "",
  domain: "figma.com",
  icon: undefined,
  interfaces: [],
  name: "Figma",
  slug: "figma",
  tagline: "Design files, components, and variables.",
  tier: "featured",
};

describe("CatalogTile", () => {
  it.each([
    ["one not here by its tagline", [], figma.tagline],
    ["a connected one as signed in", ["connected"], "Signed in"],
    // A first run set Figma up, its test failed at once, and the tile still
    // read as connected.
    ["a failed one as not connected", ["failed"], "Could not connect"],
    ["several by how many", ["connected", "failed"], "2 accounts"],
  ] as const)("says %s, and opens its page", (_, statuses, line) => {
    const onOpen = vi.fn();
    renderWithProviders(
      <CatalogTile
        entry={figma}
        mine={statuses.map((status) => ({
          authKind: "oauth",
          slug: "figma",
          status,
          type: "mcp",
        }))}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByText(line)).toBeTruthy();
    const tile = screen.getAllByRole("button");
    expect(tile).toHaveLength(1);
    fireEvent.click(tile[0]!);
    expect(onOpen).toHaveBeenCalledWith("figma");
  });
});

describe("AppsHome search", () => {
  const monarch = {
    name: "Monarch Money",
    slug: "monarch",
    status: "connected",
    type: "web",
  };
  beforeEach(() => {
    served.ask.mockClear();
    served.apps = [];
    served.catalog = [figma];
  });
  async function search(words: string) {
    const onOpenApp = vi.fn();
    renderWithProviders(<AppsHome onOpenApp={onOpenApp} />);
    await screen.findByText("Figma");
    fireEvent.change(screen.getByLabelText("Search apps"), {
      target: { value: words },
    });
    return onOpenApp;
  }

  // An app no service lists, named by its slug alone, hid the way to connect
  // one and was not shown itself, so the search came up blank.
  it.each(["monarch", "Monarch Money", "mon"])(
    "finds an app of your own no service lists by %s",
    async (words) => {
      served.apps = [monarch];
      const onOpenApp = await search(words);
      fireEvent.click(await screen.findByText("Monarch Money"));
      expect(onOpenApp).toHaveBeenCalledWith("monarch");
    },
  );

  it("offers to connect a name nothing matches", async () => {
    await search("monarch");
    fireEvent.click(await screen.findByText("Connect monarch"));
    expect(served.ask).toHaveBeenCalledWith("Connect monarch", {
      from: undefined,
    });
  });

  it("shows a listed service's own app once", async () => {
    served.apps = [
      { ...monarch, name: "Figma", service: "figma", slug: "figma" },
    ];
    await search("figma");
    expect(await screen.findByText("Add another account")).toBeTruthy();
    // Its account, and the tile that adds one.
    expect(screen.getAllByText("Figma")).toHaveLength(2);
  });

  it("holds a link to the app's page from a tile that opens one, and nothing from one that connects", async () => {
    served.apps = [
      { ...monarch, name: "Figma", service: "figma", slug: "figma" },
    ];
    await search("figma");
    fireEvent.pointerDown(await screen.findByText("Add another account"));
    expect(pressShortcut).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getAllByText("Figma")[0]!);
    expect(pressShortcut).toHaveBeenCalledWith(expect.anything(), {
      href: "/apps/figma",
      title: "Figma",
    });
  });
});
