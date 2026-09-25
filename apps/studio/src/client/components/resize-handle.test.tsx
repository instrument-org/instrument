import { ResizeHandle } from "@/client/components/resize-handle";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, expect, it, vi } from "vitest";

// jsdom implements PointerEvent but not pointer capture; the handle only asks
// for it and checks whether it still holds it.
beforeAll(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
});

function renderHandle(
  props: Partial<React.ComponentProps<typeof ResizeHandle>> = {},
) {
  const calls = {
    onReset: vi.fn(),
    onResize: vi.fn<(width: number, release: () => void) => void>(),
    onResizeEnd: vi.fn(),
    onResizeStart: vi.fn(),
  };
  render(
    <ResizeHandle
      getWidth={() => 200}
      grows="right"
      label="Resize"
      max={400}
      min={100}
      {...calls}
      {...props}
    />,
  );
  return { calls, handle: screen.getByRole("separator") };
}

it.each([
  { expected: 250, grows: "right" as const },
  { expected: 150, grows: "left" as const },
])(
  "moves a $grows-growing width by the pointer's travel from the press",
  ({ expected, grows }) => {
    const { calls, handle } = renderHandle({ grows });
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 550, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(calls.onResizeStart).toHaveBeenCalledOnce();
    expect(calls.onResize.mock.calls.map(([width]) => width)).toEqual([
      expected,
    ]);
    expect(calls.onResizeEnd).toHaveBeenCalledOnce();
  },
);

it("measures from the anchor when one is given", () => {
  const { calls, handle } = renderHandle({ anchor: () => 1000, grows: "left" });
  fireEvent.pointerDown(handle, { button: 0, clientX: 700, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 680, pointerId: 1 });
  expect(calls.onResize.mock.calls[0]?.[0]).toBe(320);
});

it("ignores another pointer and stops following once the drag ends", () => {
  const { calls, handle } = renderHandle();
  fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 600, pointerId: 2 });
  fireEvent.lostPointerCapture(handle, { pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 600, pointerId: 1 });
  expect(calls.onResize).not.toHaveBeenCalled();
  expect(calls.onResizeEnd).toHaveBeenCalledOnce();
});

it("lets go and collapses under the threshold, without ending as a resize", () => {
  const onCollapse = vi.fn();
  const { calls, handle } = renderHandle({
    collapse: { below: 80, onCollapse },
  });
  fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 370, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 500, pointerId: 1 });
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(onCollapse).toHaveBeenCalledOnce();
  expect(calls.onResize).not.toHaveBeenCalled();
  expect(calls.onResizeEnd).not.toHaveBeenCalled();
});

it("lets go when the resize asks to", () => {
  const onResize = vi.fn((_width: number, release: () => void) => {
    release();
  });
  const { calls, handle } = renderHandle({ onResize });
  fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 510, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 520, pointerId: 1 });
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(onResize).toHaveBeenCalledOnce();
  expect(calls.onResizeEnd).not.toHaveBeenCalled();
});

it.each([
  { expected: 184, grows: "right" as const, key: "ArrowLeft" },
  { expected: 216, grows: "right" as const, key: "ArrowRight" },
  { expected: 216, grows: "left" as const, key: "ArrowLeft" },
  { expected: 100, grows: "right" as const, key: "Home" },
  { expected: 400, grows: "right" as const, key: "End" },
])(
  "steps a $grows-growing width to $expected on $key",
  ({ expected, grows, key }) => {
    const { calls, handle } = renderHandle({ grows });
    fireEvent.keyDown(handle, { key });
    expect(calls.onResize.mock.calls[0]?.[0]).toBe(expected);
    expect(calls.onResizeEnd).toHaveBeenCalledOnce();
  },
);

it("resets on a double-click", () => {
  const { calls, handle } = renderHandle();
  fireEvent.doubleClick(handle);
  expect(calls.onReset).toHaveBeenCalledOnce();
});

it("stays out of the tab order and assistive tech without a label", () => {
  const { container } = render(
    <ResizeHandle getWidth={() => 200} grows="right" onResize={vi.fn()} />,
  );
  const handle = container.firstElementChild;
  expect(handle?.getAttribute("aria-hidden")).toBe("true");
  expect(handle?.hasAttribute("tabindex")).toBe(false);
});
