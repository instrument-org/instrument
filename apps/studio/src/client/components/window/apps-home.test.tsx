import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CatalogTile } from "./apps-home";

const { testApp } = vi.hoisted(() => ({
  testApp: vi.fn((_input: { slug: string }) =>
    Promise.resolve({ checks: [], passed: true }),
  ),
}));

// Nothing here opens a link.
vi.mock("@/client/hooks/use-open-external-link", () => ({
  useOpenExternalLink: () => () => undefined,
}));
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    apps: {
      test: {
        mutationOptions: (options: object) => ({
          ...options,
          mutationFn: testApp,
        }),
      },
    },
  },
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

function renderTile(status: "connected" | "failed") {
  const onOpen = vi.fn();
  renderWithProviders(
    <CatalogTile
      entry={figma}
      mine={[{ name: "Figma", slug: "figma", status }]}
      onConnect={vi.fn()}
      onConnectAnother={vi.fn()}
      onOpen={onOpen}
    />,
  );
  return { onOpen };
}

beforeEach(() => {
  testApp.mockClear();
});

describe("CatalogTile", () => {
  it("says a connected app is in your apps and opens it", () => {
    const { onOpen } = renderTile("connected");
    expect(screen.getByText("In your apps")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledWith("figma");
  });

  // A first run set Figma up, its test failed at once, and the tile still
  // said "In your apps" with Open, which read as connected.
  it("says a failed app did not connect and tries it again", async () => {
    renderTile("failed");
    expect(screen.queryByText("In your apps")).toBeNull();
    expect(screen.getByText("Could not connect")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(testApp).toHaveBeenCalled();
    });
    expect(testApp.mock.calls[0]?.[0]).toEqual({ slug: "figma" });
  });
});
