import { renderInBrowser } from "@/tests/render-browser";
import { createPortal } from "react-dom";
import { describe, expect, it } from "vitest";

import { ScreenToolsRow, useRowSlots } from "./row-slots";

function FilesHead({
  fileTools = false,
  tools,
}: {
  fileTools?: boolean;
  tools: boolean;
}) {
  const { rowProps, slots, viewEnd } = useRowSlots();
  return (
    <div className="flex h-96 w-[600px] flex-col">
      <ScreenToolsRow end={viewEnd} lead={rowProps.leading} />
      <div className="min-h-0 flex-1" data-testid="file" />
      {tools &&
        slots.lead &&
        createPortal(<button type="button">Sort</button>, slots.lead)}
      {fileTools &&
        slots.view &&
        createPortal(<button type="button">More actions</button>, slots.view)}
    </div>
  );
}

const fileTop = (container: HTMLElement) => {
  const file = container.querySelector("[data-testid=file]");
  const head = file?.parentElement;
  if (!(file instanceof HTMLElement) || !head) {
    throw new Error("the file's place is missing");
  }
  return file.getBoundingClientRect().top - head.getBoundingClientRect().top;
};

describe("the Files tools row", () => {
  it("takes no room above a file open alone, where nothing is drawn into it", async () => {
    const { container } = await renderInBrowser(<FilesHead tools={false} />);
    await expect.poll(() => fileTop(container)).toBe(0);
  });

  it("stands above the folder once its controls are drawn into it", async () => {
    const { container } = await renderInBrowser(<FilesHead tools />);
    await expect.poll(() => fileTop(container)).toBe(44);
  });

  it("stands above a file alone that draws its controls into its end, at the right edge", async () => {
    const { container, getByRole } = await renderInBrowser(
      <FilesHead fileTools tools={false} />,
    );
    await expect.poll(() => fileTop(container)).toBe(44);
    const head = container.querySelector("[data-testid=file]")?.parentElement;
    const button = getByRole("button", { name: "More actions" }).element();
    await expect
      .poll(
        () =>
          (head?.getBoundingClientRect().right ?? 0) -
          button.getBoundingClientRect().right,
      )
      .toBeLessThan(12);
  });
});
