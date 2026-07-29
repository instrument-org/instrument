import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import { Button } from "../components/ui/button";
import { immediateClickHandlers } from "./immediate-click";

function dispatchPointer(
  target: Element,
  type: "click" | "pointerdown" | "pointerup",
  pointerType: "mouse" | "touch",
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      button: 0,
      detail: type === "click" ? 1 : 0,
      pointerType,
    }),
  );
}

describe("immediate click activation", () => {
  it("runs once for a complete mouse click", async () => {
    const onClick = vi.fn();
    await render(<Button onClick={onClick}>Open</Button>);

    await userEvent.click(page.getByRole("button", { name: "Open" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("activates on primary mouse-down without repeating on click", async () => {
    const onClick = vi.fn();
    const { container } = await render(<Button onClick={onClick}>Open</Button>);
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    if (!button) {
      return;
    }

    dispatchPointer(button, "pointerdown", "mouse");
    expect(onClick).toHaveBeenCalledTimes(1);

    dispatchPointer(button, "click", "mouse");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("preserves release activation for keyboard and touch", async () => {
    const onClick = vi.fn();
    const { container } = await render(<Button onClick={onClick}>Open</Button>);
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    if (!button) {
      return;
    }

    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
    await userEvent.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);

    dispatchPointer(button, "pointerdown", "touch");
    expect(onClick).toHaveBeenCalledTimes(2);
    dispatchPointer(button, "click", "touch");
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it("gives up pointer cancellation: a press that never releases here still acts", async () => {
    const onClick = vi.fn();
    const { container } = await render(<Button onClick={onClick}>Open</Button>);
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    if (!button) {
      return;
    }

    // Press, then release somewhere else so no click ever lands here. The
    // action has already run: moving away no longer cancels it, which is the
    // tradeoff this activation makes.
    dispatchPointer(button, "pointerdown", "mouse");
    expect(onClick).toHaveBeenCalledTimes(1);

    dispatchPointer(button, "pointerup", "mouse");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not double-fire a release-activated ancestor", async () => {
    const onAncestorClick = vi.fn();
    const onClick = vi.fn();
    await render(
      <div onClick={onAncestorClick}>
        <Button onClick={onClick}>Open</Button>
      </div>,
    );

    await userEvent.click(page.getByRole("button", { name: "Open" }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onAncestorClick).toHaveBeenCalledTimes(1);
  });

  it("lets nested controls stop an immediate parent activation", async () => {
    const onOuterClick = vi.fn();
    const onInnerClick = vi.fn();
    const { container } = await render(
      <div
        {...immediateClickHandlers<HTMLDivElement>({
          onClick: onOuterClick,
        })}
      >
        <button
          {...immediateClickHandlers<HTMLButtonElement>({
            activation: "release",
            onClick: onInnerClick,
            onPointerDown: (event) => {
              event.stopPropagation();
            },
          })}
          type="button"
        >
          More
        </button>
      </div>,
    );
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    if (!button) {
      return;
    }

    dispatchPointer(button, "pointerdown", "mouse");
    dispatchPointer(button, "click", "mouse");
    expect(onInnerClick).toHaveBeenCalledTimes(1);
    expect(onOuterClick).not.toHaveBeenCalled();
  });

  it("acts on the first click, with no hover or arming delay in front of it", async () => {
    // A press-activated control that guards its own handler drops the click
    // entirely, because the release is suppressed too. Guarding the open action
    // behind a hover delay made file cards dead until the delay elapsed.
    const onClick = vi.fn();
    await render(<Button onClick={onClick}>Open</Button>);

    await userEvent.click(page.getByRole("button", { name: "Open" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("never acts on a mouse click, so a guarded press is dropped not deferred", async () => {
    // The shape `MediaCardShell` relies on: a press the component decides to
    // ignore must not come back as a click on release.
    const onClick = vi.fn();
    let guarded = true;
    await render(
      <button
        {...immediateClickHandlers<HTMLButtonElement>({
          onClick: () => {
            if (guarded) {
              return;
            }
            onClick();
          },
        })}
        type="button"
      >
        Open
      </button>,
    );

    await userEvent.click(page.getByRole("button", { name: "Open" }));
    expect(onClick).not.toHaveBeenCalled();

    guarded = false;
    await userEvent.click(page.getByRole("button", { name: "Open" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps destructive and submit buttons on release", async () => {
    const onDestructive = vi.fn();
    const onSubmit = vi.fn();
    const { container } = await render(
      <>
        <Button onClick={onDestructive} variant="destructive">
          Delete
        </Button>
        <Button onClick={onSubmit} type="submit">
          Save
        </Button>
      </>,
    );
    const [destructive, submit] = container.querySelectorAll("button");
    expect(destructive).toBeDefined();
    expect(submit).toBeDefined();
    if (!destructive || !submit) {
      return;
    }

    dispatchPointer(destructive, "pointerdown", "mouse");
    dispatchPointer(submit, "pointerdown", "mouse");
    expect(onDestructive).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();

    dispatchPointer(destructive, "click", "mouse");
    dispatchPointer(submit, "click", "mouse");
    expect(onDestructive).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("leaves activation to the child when asChild is set", async () => {
    const onChildClick = vi.fn();
    const { container } = await render(
      <Button asChild>
        <button
          {...immediateClickHandlers<HTMLButtonElement>({
            activation: "release",
            onClick: onChildClick,
          })}
          type="button"
        >
          Go
        </button>
      </Button>,
    );
    const child = container.querySelector("button");
    expect(child).not.toBeNull();
    if (!child) {
      return;
    }

    // The child owns activation. `Button` must neither fire it on press nor
    // clobber its handler by spreading an explicit `undefined` through Slot.
    dispatchPointer(child, "pointerdown", "mouse");
    expect(onChildClick).not.toHaveBeenCalled();

    dispatchPointer(child, "click", "mouse");
    expect(onChildClick).toHaveBeenCalledTimes(1);
  });
});
