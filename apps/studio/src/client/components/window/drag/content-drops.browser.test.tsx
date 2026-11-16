import { renderInBrowser } from "@/tests/render-browser";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { useContentDrag } from "./content-drag";
import { currentDrag, type DropTarget, useDropTarget } from "./session";
import { type Landing } from "./types";
import { useSystemDrags } from "./use-drag-system";

vi.mock("@/client/rpc/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/client/rpc/client")>()),
  rpcClient: {
    files: { dragged: { call: () => Promise.resolve({ files: null }) } },
    utils: { prepareDrag: { call: () => Promise.resolve() } },
  },
}));

const LINK = {
  kind: "link",
  title: "Example",
  url: "https://example.com/",
} as const;

/** Over the page's rect, the window's target answers as a side's page does over a site or over its own ground. */
const PAGE = { height: 300, left: 200, top: 100, width: 400 };

function Window({
  answer,
  onLand,
}: {
  answer: Landing | "native";
  onLand: (url: string, landing: Landing) => void;
}) {
  useSystemDrags((held, landing) => {
    onLand(held.kind === "link" ? held.url : "", landing);
  });
  useDropTarget({
    landingAt: () => answer,
    rect: () => PAGE,
  } satisfies DropTarget);
  const dragProps = useContentDrag(LINK);
  return (
    <>
      <div
        {...dragProps}
        style={{ height: 30, left: 10, position: "fixed", top: 10, width: 120 }}
      >
        Example
      </div>
      <iframe
        style={{
          border: 0,
          height: PAGE.height,
          left: PAGE.left,
          position: "fixed",
          top: PAGE.top,
          width: PAGE.width,
        }}
        title="page"
      />
    </>
  );
}

/** A page in a frame of its own, as a guest is, that takes a link dropped on it and says which. */
function pageTakingDrops(frame: HTMLIFrameElement) {
  const inside = frame.contentDocument;
  if (!inside) {
    throw new Error("no page");
  }
  inside.body.style.cssText = "margin:0;height:100vh";
  const dropped: string[] = [];
  inside.addEventListener("dragover", (event) => {
    event.preventDefault();
  });
  inside.addEventListener("drop", (event) => {
    event.preventDefault();
    dropped.push(event.dataTransfer?.getData("text/uri-list") ?? "");
  });
  return dropped;
}

afterEach(() => {
  document.body.replaceChildren();
});

it("lets a page take content let go on it where no window target claims it", async () => {
  const onLand = vi.fn();
  const screen = await renderInBrowser(
    <Window answer="native" onLand={onLand} />,
  );
  const frame = screen.container.ownerDocument.querySelector("iframe");
  if (!frame) {
    throw new Error("no frame");
  }
  const dropped = pageTakingDrops(frame);

  await userEvent.dragAndDrop(
    screen.getByText("Example"),
    screen.getByTitle("page"),
  );

  expect(dropped).toEqual([LINK.url]);
  expect(onLand).not.toHaveBeenCalled();
  expect(currentDrag()).toBeUndefined();
});

it("lands this app's own link where a window target claims it, known by its address", async () => {
  const onLand = vi.fn();
  const side: Landing = {
    group: "group",
    kind: "side",
    lit: PAGE,
    side: 0,
    split: false,
  };
  const screen = await renderInBrowser(
    <Window answer={side} onLand={onLand} />,
  );
  const frame = screen.container.ownerDocument.querySelector("iframe");
  if (!frame) {
    throw new Error("no frame");
  }
  const dropped = pageTakingDrops(frame);
  // The window's own ground over the page, as the margin at a page's end is.
  const ground = document.createElement("div");
  ground.textContent = "ground";
  Object.assign(ground.style, {
    height: `${String(PAGE.height)}px`,
    left: `${String(PAGE.left)}px`,
    position: "fixed",
    top: `${String(PAGE.top)}px`,
    width: `${String(PAGE.width)}px`,
  });
  document.body.append(ground);

  await userEvent.dragAndDrop(
    screen.getByText("Example"),
    screen.getByText("ground"),
  );

  expect(onLand).toHaveBeenCalledWith(LINK.url, side);
  expect(dropped).toEqual([]);
});
