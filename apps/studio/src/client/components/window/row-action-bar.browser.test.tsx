import { renderInBrowser } from "@/tests/render-browser";
import { ArchiveIcon } from "@phosphor-icons/react/Archive";
import { expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

// Whether the row stays hovered is a question only the real stylesheet and a
// real pointer can answer: the controls show on `:hover`, and the tooltip
// covers the row only once Radix has placed it.
import { RowActionBar } from "./row-action-bar";

function frames(count: number) {
  return new Promise<void>((resolve) => {
    let left = count;
    const step = () => {
      left -= 1;
      if (left <= 0) {
        resolve();
      } else {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  });
}

it("keeps the row hovered, and its controls up, with the pointer on a control's tooltip", async () => {
  const { container } = await renderInBrowser(
    <div className="group/row flex h-40 w-80 flex-col p-2">
      <div className="flex h-5 items-center">
        <span className="min-w-0 flex-1 truncate">Guard the Nest eco mode</span>
        <RowActionBar
          actions={[
            {
              icon: <ArchiveIcon />,
              id: "archive",
              label: "Archive this chat for now",
              run: vi.fn(),
            },
          ]}
          resting={<span>2:30 PM</span>}
        />
      </div>
      <div className="flex-1" data-testid="body" />
    </div>,
  );

  const body = container.querySelector<HTMLElement>("[data-testid='body']");
  const bar = container.querySelector<HTMLElement>("[data-slot='row-actions']");
  if (!body || !bar) {
    throw new Error("the row did not render");
  }

  // The control shows only once the row is hovered.
  await userEvent.hover(body);
  await userEvent.hover(container.querySelector("button")!);
  await expect
    .poll(() =>
      document.querySelector("[data-slot='tooltip-content'][data-state]"),
    )
    .toBeTruthy();
  const tooltip = document.querySelector<HTMLElement>(
    "[data-slot='tooltip-content']",
  )!;
  // Let Radix place it under the control, where it covers the row's body.
  await frames(3);
  const covered = tooltip.getBoundingClientRect();
  const { x, y } = {
    x: covered.left + covered.width / 2,
    y: covered.top + covered.height / 2,
  };
  expect(body.contains(document.elementFromPoint(x, y))).toBe(true);

  // Forced, since the point is the one the tooltip is drawn over.
  await userEvent.hover(body, {
    force: true,
    position: {
      x: x - body.getBoundingClientRect().left,
      y: y - body.getBoundingClientRect().top,
    },
  });
  await frames(10);
  expect(getComputedStyle(bar).display).toBe("flex");
});
