import { sidebarWidthAtom } from "@/client/atoms/sidebar";
import { StudioSidebarRail } from "@/client/components/studio-sidebar-rail";
import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

// The sidebar's contents pull in the router and RPC, neither of which the rail's
// drag mechanics touch.
vi.mock("@/client/components/studio-sidebar", () => ({
  StudioSidebar: () => <div />,
}));

// jsdom implements PointerEvent but not pointer capture. The rail only ever
// asks for capture and checks whether it still holds it, so inert stubs are
// enough to let a drag start and end.
beforeAll(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
});

beforeEach(() => {
  // The width and open atoms are storage-backed with `getOnInit`, so a value a
  // test commits would otherwise become the next test's initial width.
  localStorage.clear();
});

function renderRail() {
  const rendered = renderWithProviders(
    <StudioSidebarRail isOpen onCollapse={() => {}} />,
  );
  const rail = rendered.container.firstElementChild;
  if (!(rail instanceof HTMLElement)) {
    throw new TypeError("rail did not render");
  }
  return { ...rendered, rail };
}

function handle() {
  return screen.getByLabelText("Resize sidebar");
}

// Long enough for the rail's spring (stiffness 520, damping 42) to visibly
// move, and for a settled value to be a settled value rather than a frame the
// spring is passing through.
const SPRING_SETTLE_MS = 400;

it("ends the drag and commits the width when pointer capture is lost", async () => {
  const { rail, store } = renderRail();

  fireEvent.pointerDown(handle(), { button: 0, clientX: 250, pointerId: 1 });
  fireEvent.pointerMove(handle(), { clientX: 300, pointerId: 1 });

  // Capture can end without a pointerup ever arriving: the element is replaced,
  // the window loses the device, the OS takes the gesture.
  fireEvent.lostPointerCapture(handle(), { pointerId: 1 });

  expect(store.get(sidebarWidthAtom)).toBe(300);

  // The drag is over, so a pointer merely passing over the handle must not
  // resize the rail. Motion flushes a set width to the DOM on the next frame,
  // so give it a couple before reading the style back.
  fireEvent.pointerMove(handle(), { clientX: 350, pointerId: 1 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(rail.style.width).toBe("300px");
});

it("lets a drag take the width back from the opening slide's springs", async () => {
  const { container, rerender } = renderWithProviders(
    <StudioSidebarRail isOpen={false} onCollapse={() => {}} />,
  );
  rerender(<StudioSidebarRail isOpen onCollapse={() => {}} />);
  const rail = container.firstElementChild;
  if (!(rail instanceof HTMLElement)) {
    throw new TypeError("rail did not render");
  }

  // The springs toward the stored width (250) are in flight; grab the handle
  // and drag elsewhere before they land.
  fireEvent.pointerDown(handle(), { button: 0, clientX: 250, pointerId: 1 });
  fireEvent.pointerMove(handle(), { clientX: 320, pointerId: 1 });

  await new Promise((resolve) => setTimeout(resolve, SPRING_SETTLE_MS));

  expect(rail.style.width).toBe("320px");
});

it("lets a drag take the width back from the double-click reset's springs", async () => {
  // A stored width away from the default, so the double-click reset has
  // somewhere to spring to.
  localStorage.setItem("studio.sidebar-width.v1", "480");
  const { rail } = renderRail();

  fireEvent.doubleClick(handle());

  // The reset's springs toward the default width (250) are in flight; grab the
  // handle and drag elsewhere before they land.
  fireEvent.pointerDown(handle(), { button: 0, clientX: 250, pointerId: 1 });
  fireEvent.pointerMove(handle(), { clientX: 400, pointerId: 1 });

  await new Promise((resolve) => setTimeout(resolve, SPRING_SETTLE_MS));

  expect(rail.style.width).toBe("400px");
});
