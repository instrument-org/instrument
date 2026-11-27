// First: React reads the counter's hook as it loads.
import { settled } from "@/tests/render-count";
import { renderAppWindow } from "@/tests/app-window";
import { sharedQueryClient } from "@/client/lib/tab-router";
import { rpcClient } from "@/client/rpc/client";
import { folderHref } from "@/shared/computer-href";
import { type ComputerFolder } from "@instrument-org/workspace/client";
import { expect, it, onTestFinished, vi } from "vitest";

import { SPRING_DELAY_MS } from "./spring-loading";

// What a drop asks of the main process first: whether anything in the folder
// would be replaced. Left unanswered, so the drop goes no further.
const clashes = vi.hoisted(() => vi.fn(() => new Promise(() => {})));
vi.mock("@/client/rpc/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/client/rpc/client")>();
  const files = new Proxy(actual.rpcClient.files, {
    get: (target, key, receiver) =>
      key === "clashes"
        ? { call: clashes }
        : Reflect.get(target, key, receiver),
  });
  return {
    ...actual,
    rpcClient: new Proxy(actual.rpcClient, {
      get: (target, key, receiver) =>
        key === "files" ? files : Reflect.get(target, key, receiver),
    }),
  };
});

// The Finder's own drop: files dragged over a folder ring it, a drag resting
// on a folder opens it, and a drop copies into the folder under the pointer.
// Synthetic drags carry no folders (`webkitGetAsEntry` answers only for a
// real one) and none of this app's own rows, so these cover files from
// outside the app.

const ROOT = "/Users/sam/Work";

function listing(path: string, names: string[]): ComputerFolder {
  return {
    display: path.replace("/Users/sam", "~"),
    entries: names.map((name) => ({
      kind: name.endsWith("/") ? "folder" : "file",
      name: name.replace(/\/$/, ""),
      path: `${path}/${name.replace(/\/$/, "")}`,
    })),
    kind: "listing",
    path,
    total: names.length,
    truncated: false,
  };
}

const FOLDERS: Record<string, ComputerFolder> = {
  [ROOT]: listing(ROOT, ["Drafts/", "notes.txt"]),
  [`${ROOT}/Drafts`]: listing(`${ROOT}/Drafts`, ["old.txt"]),
};

/** The Finder at `ROOT`, its listings answered from `FOLDERS` as each is asked for. */
async function openFinder() {
  await renderAppWindow();
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      ...window.api,
      getFilePath: (file: File) => `/Users/sam/Downloads/${file.name}`,
    },
  });
  sharedQueryClient.setQueryData(
    rpcClient.workspace.computer.places.queryKey(),
    { favorites: [], volumes: [] },
  );
  // Whatever spelling the Finder asks for a folder by (`~/Work`, say).
  const answer = () => {
    const asked = sharedQueryClient.getQueryCache().findAll({
      queryKey: rpcClient.workspace.computer.list.key(),
    });
    for (const query of asked) {
      // An oRPC key: the route's path, then what it was called with.
      const [, options] = query.queryKey as [
        unknown,
        { input?: { path?: string } },
      ];
      const path = options.input?.path
        ?.replace(/^~/, "/Users/sam")
        .replace(/\/$/, "");
      const folder = path === undefined ? undefined : FOLDERS[path];
      if (folder && query.state.data === undefined) {
        sharedQueryClient.setQueryData(query.queryKey, folder);
      }
    }
  };
  answer();
  onTestFinished(sharedQueryClient.getQueryCache().subscribe(answer));
  window.__studioDrive?.goto(folderHref(ROOT));
  await settled();
  const browser = await vi.waitFor(() => {
    const row = document.querySelector('[data-file-system-item="Drafts/"]');
    const found = row?.closest<HTMLElement>(
      "[data-file-system-folder]",
    )?.parentElement;
    if (!found) {
      throw new Error("the listing did not render");
    }
    return found;
  });
  return { browser };
}

function filesDrag() {
  const data = new DataTransfer();
  data.items.add(new File(["hi"], "photo.jpg", { type: "image/jpeg" }));
  return data;
}

function fire(
  node: Element,
  type: string,
  dataTransfer: DataTransfer,
  init: DragEventInit = {},
) {
  node.dispatchEvent(
    new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      ...init,
    }),
  );
}

const ring = () => document.querySelector(".ring-ring\\/75");

it("rings the folder while files are dragged over it and drops the ring on the way out", async () => {
  const { browser } = await openFinder();
  const data = filesDrag();
  fire(browser, "dragenter", data);
  fire(browser, "dragover", data);
  await vi.waitFor(() => {
    expect(ring()).not.toBeNull();
  });
  fire(browser, "dragleave", data, { relatedTarget: document.body });
  // Well before the drag would be given up for silence.
  await vi.waitFor(
    () => {
      expect(ring()).toBeNull();
    },
    { timeout: 300 },
  );
});

it("copies dropped files into the folder under the pointer", async () => {
  const { browser } = await openFinder();
  const data = filesDrag();
  const drafts = browser.querySelector('[data-file-system-item="Drafts/"]');
  if (!drafts) {
    throw new Error("no Drafts row");
  }
  fire(browser, "dragenter", data);
  fire(drafts, "drop", data);
  await vi.waitFor(() => {
    expect(clashes).toHaveBeenLastCalledWith({
      folder: `${ROOT}/Drafts`,
      op: "copy",
      paths: ["/Users/sam/Downloads/photo.jpg"],
    });
  });
  expect(ring()).toBeNull();
  fire(browser, "drop", data);
  await vi.waitFor(() => {
    expect(clashes).toHaveBeenLastCalledWith({
      folder: ROOT,
      op: "copy",
      paths: ["/Users/sam/Downloads/photo.jpg"],
    });
  });
});

it("opens a folder a drag rests on", async () => {
  const { browser } = await openFinder();
  const data = filesDrag();
  const drafts = browser.querySelector('[data-file-system-item="Drafts/"]');
  if (!drafts) {
    throw new Error("no Drafts row");
  }
  fire(drafts, "dragenter", data);
  // The drag keeps being heard from as it rests, as `dragover` repeats.
  const resting = setInterval(() => {
    fire(drafts, "dragover", data);
  }, 100);
  try {
    await vi.waitFor(
      () => {
        expect(
          document.querySelector('[data-file-system-item="Drafts/old.txt"]'),
        ).not.toBeNull();
      },
      { timeout: SPRING_DELAY_MS + 2000 },
    );
  } finally {
    clearInterval(resting);
  }
});

it("lets go of a drag it stops hearing from", async () => {
  const { browser } = await openFinder();
  const data = filesDrag();
  fire(browser, "dragenter", data);
  fire(browser, "dragover", data);
  await vi.waitFor(() => {
    expect(ring()).not.toBeNull();
  });
  // No leave and no drop: the drag ended somewhere this never heard about.
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(ring()).not.toBeNull();
  await vi.waitFor(
    () => {
      expect(ring()).toBeNull();
    },
    { timeout: 2000 },
  );
});
