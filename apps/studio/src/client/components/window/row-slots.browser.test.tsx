import { renderInBrowser } from "@/tests/render-browser";
import { createPortal } from "react-dom";
import { describe, expect, it } from "vitest";

import { ScreenToolsRow, useRowSlots } from "./row-slots";

function FilesHead({ tools }: { tools: boolean }) {
  const { rowProps, slots } = useRowSlots();
  return (
    <div className="flex h-96 flex-col">
      <ScreenToolsRow>{rowProps.leading}</ScreenToolsRow>
      <div className="min-h-0 flex-1" data-testid="file" />
      {tools &&
        slots.lead &&
        createPortal(<button type="button">Sort</button>, slots.lead)}
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
});
