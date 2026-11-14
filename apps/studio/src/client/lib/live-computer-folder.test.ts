import {
  type ChatId,
  type ComputerFolder,
  type ComputerFolderEvent,
  type ComputerListing,
} from "@instrument-org/workspace/client";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computerFolderOptions } from "./live-computer-folder";

/** The streams the stand-in main process opened, in order. */
const { opened } = vi.hoisted(() => ({
  opened: [] as {
    fail: (error: Error) => void;
    send: (event: unknown) => void;
    signal: AbortSignal;
  }[],
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      computer: {
        list: {
          queryKey: ({ input }: { input: unknown }) => [
            "workspace",
            "computer",
            "list",
            input,
          ],
        },
        live: {
          list: {
            call: (_input: unknown, { signal }: { signal: AbortSignal }) => {
              const queue: unknown[] = [];
              let failure: Error | undefined;
              let wake: (() => void) | undefined;
              opened.push({
                fail: (error) => {
                  failure = error;
                  wake?.();
                },
                send: (event) => {
                  queue.push(event);
                  wake?.();
                },
                signal,
              });
              async function* events() {
                while (!signal.aborted) {
                  const next = queue.shift();
                  if (next !== undefined) {
                    yield next;
                    continue;
                  }
                  if (failure) {
                    throw failure;
                  }
                  await new Promise<void>((resolve) => {
                    wake = resolve;
                    signal.addEventListener("abort", () => resolve(), {
                      once: true,
                    });
                  });
                }
              }
              return Promise.resolve(events());
            },
          },
        },
      },
    },
  },
}));

const input = { id: "window" as ChatId, path: "/Users/mac-user/Downloads" };

const listing = (...names: string[]): ComputerListing => ({
  display: "~/Downloads",
  entries: names.map((name) => ({
    kind: "file",
    name,
    path: `/Users/mac-user/Downloads/${name}`,
  })),
  kind: "listing",
  path: "/Users/mac-user/Downloads",
  total: names.length,
  truncated: false,
});

const snapshot = (folder: ComputerFolder): ComputerFolderEvent => ({
  folder,
  kind: "snapshot",
});

let client: QueryClient;
let stops: (() => void)[] = [];

beforeEach(() => {
  opened.length = 0;
  client = new QueryClient();
});

afterEach(() => {
  for (const stop of stops) {
    stop();
  }
  stops = [];
  client.clear();
});

/** A reader following the folder, enabled or not, as a Files tab up or behind another is. */
function reader(enabled: boolean) {
  return observe({
    ...computerFolderOptions(input, { follow: true }),
    enabled,
  });
}

/** A reader that only reads the folder, as the Info card does. */
function onlooker() {
  return observe(computerFolderOptions(input));
}

function observe(options: ReturnType<typeof computerFolderOptions>) {
  const observer = new QueryObserver(client, options);
  stops.push(observer.subscribe(() => undefined));
  return observer;
}

const names = (observer: QueryObserver<ComputerFolder>) => {
  const data = observer.getCurrentResult().data;
  return data?.kind === "listing"
    ? data.entries.map((entry) => entry.name)
    : undefined;
};

const patchAdding = (name: string, total: number): ComputerFolderEvent => {
  const { entries: upserts, ...head } = listing(name);
  return { head: { ...head, total }, kind: "patch", removed: [], upserts };
};

/** Lets the stream's reader take whatever is on its way. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("computerFolderOptions", () => {
  it("answers with the folder, then writes each patch into the same entry", async () => {
    const tab = reader(true);
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    opened[0]?.send(snapshot(listing("a.txt")));
    await vi.waitFor(() => expect(names(tab)).toEqual(["a.txt"]));

    opened[0]?.send(patchAdding("b.txt", 2));
    await vi.waitFor(() => expect(names(tab)).toEqual(["a.txt", "b.txt"]));
    expect(opened).toHaveLength(1);
  });

  it("ends the stream once its tab goes behind another, and reads again when it comes back", async () => {
    const tab = reader(true);
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    opened[0]?.send(snapshot(listing("a.txt")));
    await vi.waitFor(() => expect(names(tab)).toEqual(["a.txt"]));

    tab.setOptions({
      ...computerFolderOptions(input, { follow: true }),
      enabled: false,
    });
    await vi.waitFor(() => expect(opened[0]?.signal.aborted).toBe(true));
    // What it showed stays while it is behind.
    expect(names(tab)).toEqual(["a.txt"]);

    tab.setOptions({
      ...computerFolderOptions(input, { follow: true }),
      enabled: true,
    });
    await vi.waitFor(() => expect(opened).toHaveLength(2));
    opened[1]?.send(snapshot(listing("a.txt", "c.txt")));
    await vi.waitFor(() => expect(names(tab)).toEqual(["a.txt", "c.txt"]));
  });

  it("ends the stream when its tab goes behind another while the Info card still reads the folder", async () => {
    const tab = reader(true);
    onlooker();
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    opened[0]?.send(snapshot(listing("a.txt")));
    await vi.waitFor(() => expect(names(tab)).toEqual(["a.txt"]));

    tab.setOptions({
      ...computerFolderOptions(input, { follow: true }),
      enabled: false,
    });
    await vi.waitFor(() => expect(opened[0]?.signal.aborted).toBe(true));
  });

  it("reads the folder again when its stream breaks, so a removed folder fails as a read does", async () => {
    const tab = reader(true);
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    opened[0]?.send(snapshot(listing("a.txt")));
    await vi.waitFor(() => expect(names(tab)).toEqual(["a.txt"]));

    opened[0]?.fail(new Error("NOT_FOUND"));
    await vi.waitFor(() => expect(opened).toHaveLength(2));
    opened[1]?.fail(new Error("NOT_FOUND"));
    await vi.waitFor(() => expect(tab.getCurrentResult().isError).toBe(true));
  });

  it("follows the folder again after its stream breaks, whichever reader of it set its options last", async () => {
    const tab = reader(true);
    onlooker();
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    opened[0]?.send(snapshot(listing("a.txt")));
    await vi.waitFor(() => expect(names(tab)).toEqual(["a.txt"]));

    opened[0]?.fail(new Error("stream broke"));
    await vi.waitFor(() => expect(opened).toHaveLength(2));
    opened[1]?.send(snapshot(listing("a.txt")));
    opened[1]?.send(patchAdding("b.txt", 2));
    await vi.waitFor(() => expect(names(tab)).toEqual(["a.txt", "b.txt"]));
    expect(opened[1]?.signal.aborted).toBe(false);
  });

  it("keeps no stream for a folder read ahead with nobody following it", async () => {
    const read = client.fetchQuery(
      computerFolderOptions(input, { staleMs: 4000 }),
    );
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    opened[0]?.send(snapshot(listing("a.txt")));
    await read;
    expect(opened[0]?.signal.aborted).toBe(true);
  });

  it("follows a folder whose tab opens while it is being read ahead", async () => {
    const read = client.fetchQuery(
      computerFolderOptions(input, { staleMs: 4000 }),
    );
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    const tab = reader(true);
    opened[0]?.send(snapshot(listing("a.txt")));
    await read;
    opened[0]?.send(patchAdding("b.txt", 2));
    await vi.waitFor(() => expect(names(tab)).toEqual(["a.txt", "b.txt"]));
    expect(opened).toHaveLength(1);
  });

  it("shows a folder read ahead at once when its tab opens, then reads it again to follow it", async () => {
    const read = client.fetchQuery(
      computerFolderOptions(input, { staleMs: 4000 }),
    );
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    opened[0]?.send(snapshot(listing("a.txt")));
    await read;

    const tab = reader(true);
    expect(names(tab)).toEqual(["a.txt"]);
    await vi.waitFor(() => expect(opened).toHaveLength(2));
    opened[1]?.send(snapshot(listing("a.txt")));
    opened[1]?.send(patchAdding("b.txt", 2));
    await vi.waitFor(() => expect(names(tab)).toEqual(["a.txt", "b.txt"]));
  });

  it("ends a stream at its next change once its reader turns itself off after reading", async () => {
    const tab = observe({
      ...computerFolderOptions(input, { follow: true }),
      // As a tab behind another reads: once, then never again.
      enabled: (query) => query.state.data === undefined,
    });
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    opened[0]?.send(snapshot(listing("a.txt")));
    await vi.waitFor(() => expect(names(tab)).toEqual(["a.txt"]));

    opened[0]?.send(snapshot(listing("a.txt", "b.txt")));
    await vi.waitFor(() => expect(opened[0]?.signal.aborted).toBe(true));
    await settle();
    expect(names(tab)).toEqual(["a.txt"]);
  });
});
