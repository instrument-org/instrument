import { KEPT_STATE_CHANNEL } from "@/shared/kept-state";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import { keptChangeFeed } from "./kept-changes";

/** The preload's IPC as a plain emitter: a send from main is an emit with an event first. */
function fakeIpc() {
  const ipc = new EventEmitter();
  const send = (key: string, value: unknown) => {
    ipc.emit(KEPT_STATE_CHANNEL.changed, {}, "layout", key, value);
  };
  return { ipc, send };
}

describe("what other windows keep, as a loading window's renderer hears it", () => {
  it("hands its first listener the changes sent before it listened, then the rest", () => {
    const { ipc, send } = fakeIpc();
    const onChange = keptChangeFeed(ipc);
    send("window-tabs.v11/group:a", { tabs: ["chat"] });
    send("window-tabs.v11/group:a", { tabs: ["chat", "page"] });
    const heard: unknown[] = [];
    onChange((file, key, value) => {
      heard.push([file, key, value]);
    });
    send("window-tabs.v11/group:b", undefined);
    expect(heard).toMatchInlineSnapshot(`
      [
        [
          "layout",
          "window-tabs.v11/group:a",
          {
            "tabs": [
              "chat",
            ],
          },
        ],
        [
          "layout",
          "window-tabs.v11/group:a",
          {
            "tabs": [
              "chat",
              "page",
            ],
          },
        ],
        [
          "layout",
          "window-tabs.v11/group:b",
          undefined,
        ],
      ]
    `);
  });

  it("stops holding once the renderer listens, and stops sending once it lets go", () => {
    const { ipc, send } = fakeIpc();
    const onChange = keptChangeFeed(ipc);
    const heard: string[] = [];
    const stop = onChange((_file, key) => {
      heard.push(key);
    });
    send("a", 1);
    stop();
    send("b", 2);
    expect(heard).toEqual(["a"]);
    expect(ipc.listenerCount(KEPT_STATE_CHANNEL.changed)).toBe(0);
  });
});
