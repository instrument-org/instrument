import { rpcClient } from "@/client/rpc/client";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../../tests/render";
import { BrowserDownloadsButton } from "./browser-downloads";

describe("BrowserDownloadsButton", () => {
  it.each([
    // A backslash is a character a name can hold on a Mac or Linux.
    ["/Users/sam/Downloads/a\\b.txt", "a\\b.txt"],
    ["C:\\Users\\sam\\Downloads\\report.pdf", "report.pdf"],
  ])("lists the file saved at %s as %s", async (path, name) => {
    const { queryClient } = renderWithProviders(<BrowserDownloadsButton />);
    queryClient.setQueryData(
      rpcClient.browser.live.downloads.experimental_liveOptions().queryKey,
      [
        {
          exists: true,
          filename: "download",
          id: "download-1",
          path,
          receivedBytes: 1,
          startedAt: 0,
          state: "completed",
          totalBytes: 1,
          url: "https://example.com/download",
        },
      ],
    );

    fireEvent.click(await screen.findByRole("button"));

    expect(await screen.findByText(name)).toBeDefined();
  });
});
