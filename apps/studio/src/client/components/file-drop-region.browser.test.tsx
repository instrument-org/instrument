import { FileDropRegion } from "@/client/components/file-drop-region";
import {
  releaseSelfFileDrag,
  trackSelfFileDrag,
} from "@/client/lib/self-file-drag";
import { renderInBrowser } from "@/tests/render-browser";
import { beforeEach, expect, test, vi } from "vitest";

const NOTE = "Drop to attach to your message";

// Module state, so a test that marks a drag would otherwise hand it to the
// next one.
beforeEach(releaseSelfFileDrag);

async function drawRegion(onFilesDropped = vi.fn()) {
  const screen = await renderInBrowser(
    <FileDropRegion note={NOTE} onFilesDropped={onFilesDropped}>
      <p>contents</p>
    </FileDropRegion>,
  );
  const region = screen.container.firstElementChild;
  if (!region) {
    throw new Error("the region did not render");
  }
  return {
    isRingUp: () => screen.container.textContent.includes(NOTE),
    onFilesDropped,
    region,
  };
}

/**
 * A drag carrying what the drop handler will actually read. Synthetic events
 * cannot report a directory -- `webkitGetAsEntry` answers for real OS drags
 * only -- so these cover the file half and the overlay's whole lifecycle,
 * which is where the failures that strand an overlay on screen live.
 */
function fileDrag() {
  const data = new DataTransfer();
  data.items.add(new File(["hello"], "kitten.jpg", { type: "image/jpeg" }));
  return data;
}

function fire(node: Element, type: string, dataTransfer: DataTransfer) {
  node.dispatchEvent(
    new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }),
  );
}

function textDrag() {
  const data = new DataTransfer();
  data.setData("text/plain", "not a file");
  return data;
}

test("raises the ring for a file drag and drops it again on the way out", async () => {
  const { isRingUp, region } = await drawRegion();

  fire(region, "dragenter", fileDrag());
  await vi.waitFor(() => {
    expect(isRingUp()).toBe(true);
  });

  fire(region, "dragleave", fileDrag());
  await vi.waitFor(() => {
    expect(isRingUp()).toBe(false);
  });
});

test("stays down for a drag carrying no files", async () => {
  const { isRingUp, region } = await drawRegion();

  fire(region, "dragenter", textDrag());
  await vi.waitFor(() => {
    expect(region.isConnected).toBe(true);
  });

  expect(isRingUp()).toBe(false);
});

test("a dragleave with no dragenter behind it does not strand the ring", async () => {
  const { isRingUp, region } = await drawRegion();

  // What a tab switched away from and back to mid-drag delivers: the enter went
  // to listeners that are gone, and only the leave lands here. An unclamped
  // depth count goes negative on it and never returns to zero, which leaves the
  // next real drag's ring up for the life of the region.
  fire(region, "dragleave", fileDrag());

  fire(region, "dragenter", fileDrag());
  await vi.waitFor(() => {
    expect(isRingUp()).toBe(true);
  });

  fire(region, "dragleave", fileDrag());
  // Well inside the stale-drag timeout, so this is the depth count doing the
  // work and not the watchdog quietly covering for it.
  await vi.waitFor(
    () => {
      expect(isRingUp()).toBe(false);
    },
    { timeout: 300 },
  );
});

test("takes the ring down when a drag stops reporting itself", async () => {
  const { isRingUp, region } = await drawRegion();

  fire(region, "dragenter", fileDrag());
  await vi.waitFor(() => {
    expect(isRingUp()).toBe(true);
  });

  // No leave and no drop, which is what a drag dropped on another window or
  // cancelled outside this one looks like from in here. The overlay comes down
  // on its own once `dragover` has gone quiet.
  await vi.waitFor(
    () => {
      expect(isRingUp()).toBe(false);
    },
    { timeout: 4000 },
  );
});

test("hands a dropped file over and takes the ring down", async () => {
  const { isRingUp, onFilesDropped, region } = await drawRegion();

  fire(region, "dragenter", fileDrag());
  await vi.waitFor(() => {
    expect(isRingUp()).toBe(true);
  });

  fire(region, "drop", fileDrag());
  await vi.waitFor(() => {
    expect(onFilesDropped).toHaveBeenCalledTimes(1);
  });

  const [files] = onFilesDropped.mock.calls[0] as [FileList];
  expect(files).toHaveLength(1);
  expect(files[0]?.name).toBe("kitten.jpg");
  expect(isRingUp()).toBe(false);
});

test("ignores a drop from a drag this app started", async () => {
  const { isRingUp, onFilesDropped, region } = await drawRegion();

  // What a quick click on a file card produces: the drag threshold is crossed,
  // the OS takes the file, and the button comes up again before the pointer has
  // gone anywhere.
  trackSelfFileDrag();
  fire(region, "dragenter", fileDrag());
  expect(isRingUp()).toBe(false);

  fire(region, "drop", fileDrag());
  expect(onFilesDropped).not.toHaveBeenCalled();
});

test("takes the drop once that drag has been somewhere else", async () => {
  const { isRingUp, onFilesDropped, region } = await drawRegion();

  trackSelfFileDrag();
  fire(region, "dragenter", fileDrag());
  // Leaving the window is what tells the two apart, and it runs through the
  // same `dragleave` bookkeeping any drag does.
  fire(region, "dragleave", fileDrag());

  fire(region, "dragenter", fileDrag());
  await vi.waitFor(() => {
    expect(isRingUp()).toBe(true);
  });

  fire(region, "drop", fileDrag());
  await vi.waitFor(() => {
    expect(onFilesDropped).toHaveBeenCalledTimes(1);
  });
});
