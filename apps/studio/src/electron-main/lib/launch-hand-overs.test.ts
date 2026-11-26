import { describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return { app: new EventEmitter() };
});

const { app } = await import("electron");
const { catchHandOvers, takeHandOvers } = await import("./launch-hand-overs");

const event = () => ({ preventDefault: vi.fn() });

describe("launch hand-overs", () => {
  it("keeps what comes before the main module takes them, in order, then hands over as they come", () => {
    catchHandOvers();
    const fileEvent = event();
    app.emit("open-file", fileEvent, "/tmp/a.txt");
    app.emit("open-url", event(), "instrument://chats");
    app.emit("second-instance", event(), ["instrument", "--new-window"]);

    const taken: unknown[] = [];
    takeHandOvers((handOver) => taken.push(handOver));
    app.emit("activate", event());

    expect(fileEvent.preventDefault).toHaveBeenCalled();
    expect(taken).toMatchInlineSnapshot(`
      [
        {
          "kind": "file",
          "path": "/tmp/a.txt",
        },
        {
          "kind": "link",
          "url": "instrument://chats",
        },
        {
          "commandLine": [
            "instrument",
            "--new-window",
          ],
          "kind": "secondLaunch",
        },
        {
          "kind": "activate",
        },
      ]
    `);
  });
});
