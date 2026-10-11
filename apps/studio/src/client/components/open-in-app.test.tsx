import { renderWithProviders } from "@/tests/render";
import { skipToken } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenInAppButton } from "./open-in-app";

const { browserTarget, fileTarget, openExternalLink, openPath } = vi.hoisted(
  () => ({
    browserTarget: vi.fn<() => Promise<unknown>>(),
    fileTarget: vi.fn<() => Promise<unknown>>(),
    openExternalLink: vi.fn(),
    openPath: vi.fn(),
  }),
);

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    utils: {
      browserOpenTarget: {
        queryOptions: ({ enabled, ...rest }: { enabled: boolean }) => ({
          ...rest,
          enabled,
          queryFn: browserTarget,
          queryKey: ["browserOpenTarget"],
        }),
      },
      fileManagerApp: {
        queryOptions: () => ({ queryFn: skipToken, queryKey: ["fileManager"] }),
      },
      fileOpenCandidates: {
        queryOptions: () => ({ queryFn: skipToken, queryKey: ["candidates"] }),
      },
      fileOpenTarget: {
        queryOptions: ({ input, ...rest }: { input: unknown }) => ({
          ...rest,
          queryFn: input === skipToken ? skipToken : fileTarget,
          queryKey: ["fileOpenTarget", input],
        }),
      },
      openExternalLink: {
        mutationOptions: (options: object) => ({
          ...options,
          mutationFn: openExternalLink,
        }),
      },
      openPath: {
        mutationOptions: (options: object) => ({
          ...options,
          mutationFn: openPath,
        }),
      },
    },
  },
}));

beforeEach(() => {
  browserTarget.mockReset();
  fileTarget.mockReset();
  openExternalLink.mockReset();
  openPath.mockReset();
});

describe("OpenInAppButton", () => {
  it("names the default browser for a site and opens the page there", async () => {
    browserTarget.mockResolvedValue({
      appName: "Safari",
      iconUrl: "instrument-icon://safari.png",
    });
    renderWithProviders(
      <OpenInAppButton target={{ url: "https://example.com/a" }} />,
    );

    const button = await screen.findByRole("button", {
      name: "Open in Safari",
    });
    expect(button.querySelector("img")?.getAttribute("src")).toBe(
      "instrument-icon://safari.png",
    );
    fireEvent.click(button);
    await waitFor(() => {
      expect(openExternalLink.mock.calls[0]?.[0]).toEqual({
        url: "https://example.com/a",
      });
    });
  });

  it("names the file's app and opens the file there", async () => {
    fileTarget.mockResolvedValue({
      appName: "Preview",
      iconUrl: "instrument-icon://preview.png",
    });
    renderWithProviders(
      <OpenInAppButton target={{ hostPath: "/Users/casey/report.pdf" }} />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Open in Preview" }),
    );
    await waitFor(() => {
      expect(openPath.mock.calls[0]?.[0]).toEqual({
        filepath: "/Users/casey/report.pdf",
      });
    });
  });

  it("falls back to a generic way out when no browser can be named", async () => {
    browserTarget.mockResolvedValue({ appName: null, iconUrl: null });
    renderWithProviders(
      <OpenInAppButton target={{ url: "https://example.com/" }} />,
    );

    const button = await screen.findByRole("button", {
      name: "Open in browser",
    });
    expect(button.querySelector("img")).toBeNull();
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("holds its place empty while the app is looked up", () => {
    browserTarget.mockReturnValue(new Promise(() => null));
    const { container } = renderWithProviders(
      <OpenInAppButton target={{ url: "https://example.com/" }} />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(container.firstElementChild?.className).toContain("size-5.5");
  });
});
