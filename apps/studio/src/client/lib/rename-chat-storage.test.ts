import { describe, expect, it } from "vitest";

import { renameChatStorage } from "./rename-chat-storage";

function storageOf(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    clear: () => {
      map.clear();
    },
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("renameChatStorage", () => {
  it("moves the window's stored addresses and small views to chats", () => {
    const storage = storageOf({
      "orchestrator.app-tabs.v1": JSON.stringify({
        tabs: [
          { pathname: "/orchestrator/threads/ses_01J9" },
          { pathname: "/orchestrator/tasks/book?thread=ses_01J9&tab=1" },
          { pathname: "/orchestrator/tasks?thread=ses_01J9" },
        ],
      }),
      "orchestrator.compose.v1": JSON.stringify([
        { kind: "thread", sessionId: "ses_01J9" },
      ]),
    });

    renameChatStorage(storage);

    expect(storage.getItem("orchestrator.app-tabs.v1")).toBe(
      JSON.stringify({
        tabs: [
          { pathname: "/orchestrator/chats/ses_01J9" },
          { pathname: "/orchestrator/tasks/book?chat=ses_01J9&tab=1" },
          { pathname: "/orchestrator/tasks?chat=ses_01J9" },
        ],
      }),
    );
    expect(storage.getItem("orchestrator.compose.v1")).toBe(
      JSON.stringify([{ kind: "chat", sessionId: "ses_01J9" }]),
    );
  });

  it("leaves what is not the window's alone", () => {
    const value = JSON.stringify({
      pathname: "/orchestrator/threads/ses_01J9",
    });
    const storage = storageOf({ "studio.tabs.v1": value });

    renameChatStorage(storage);

    expect(storage.getItem("studio.tabs.v1")).toBe(value);
  });
});
