import { renderWithProviders } from "@/tests/render";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FileSystem, FileSystemRowGlyph } from "./file-system";

describe("FileSystem", () => {
  it.each(["icons", "list"] as const)(
    "holds off saying a folder still being read is empty in %s",
    (view) => {
      renderWithProviders(
        <FileSystem
          defaultView={view}
          items={[]}
          pendingFolders={new Set([""])}
        />,
      );

      expect(screen.queryByText("This folder is empty")).toBeNull();
      expect(screen.getByRole("status")).toBeTruthy();
    },
  );

  it("says a folder read with nothing in it is empty", () => {
    renderWithProviders(<FileSystem defaultView="list" items={[]} />);

    expect(screen.getByText("This folder is empty")).toBeTruthy();
  });
});

describe("FileSystemRowGlyph", () => {
  it.each([
    ["artwork.ai", "application/postscript"],
    ["ARTWORK.AI", undefined],
    ["artwork.psd", "image/vnd.adobe.photoshop"],
    ["artwork.psd", undefined],
  ])("shows the artwork thumbnail for %s (%s)", (name, contentType) => {
    const { container } = renderWithProviders(
      <FileSystemRowGlyph
        entry={{
          contentType,
          kind: "file",
          name,
          previewImageUrl: "data:image/png;base64,QUJD",
        }}
      />,
    );

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,QUJD",
    );
  });
});
