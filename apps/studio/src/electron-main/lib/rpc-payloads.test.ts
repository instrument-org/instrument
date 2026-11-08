import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { os, type RouterClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import { createAlarmGate } from "@instrument-org/shared/alarms";
import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";

vi.mock("./electron-logger", () => ({
  createScopedLogger: () => ({ warn: vi.fn() }),
}));

const { createPayloadMeter, meterRPCPayloads, readFrameHead } =
  await import("./rpc-payloads");

const MB = 1_000_000;
const HOUR = 60 * 60_000;

const request = (id: string, path: string) =>
  JSON.stringify({ i: id, p: { u: `/${path.replaceAll(".", "/")}`, b: {} } });
const response = (id: string, size = 0) =>
  JSON.stringify({ i: id, p: { b: { json: "x".repeat(size) } } });
const streamOpens = (id: string) =>
  JSON.stringify({ i: id, p: { h: { "content-type": "text/event-stream" } } });
const event = (id: string, kind: string, size = 0) =>
  JSON.stringify({
    i: id,
    t: 3,
    p: { e: kind, d: { json: "x".repeat(size) } },
  });
const abort = (id: string) => JSON.stringify({ i: id, t: 4 });

function setup(limits = { messageBytes: MB, minuteBytes: 10 * MB }) {
  let clock = 0;
  const now = () => clock;
  const warn = vi.fn<(message: string) => void>();
  const meter = createPayloadMeter({
    window: 7,
    warn,
    now,
    gate: createAlarmGate({ now }),
    limits,
  });
  return {
    meter,
    warn,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

it.each([
  [request("1", "chats.live.list"), { id: "1", path: "chats.live.list" }],
  [response("1"), { id: "1", type: undefined, opensStream: false }],
  [streamOpens("2"), { id: "2", opensStream: true }],
  [event("2", "message"), { id: "2", type: 3, event: "message" }],
  [event("2", "done"), { id: "2", type: 3, event: "done" }],
  [abort("3"), { id: "3", type: 4 }],
])("reads the head of %s", (frame, expected) => {
  expect(readFrameHead(frame)).toMatchObject(expected);
});

it.each([["not json"], ['{"x":1}'], [""], [42], [{ i: "1" }], [null]])(
  "reads nothing from %j",
  (frame) => {
    expect(readFrameHead(frame)).toBeUndefined();
  },
);

it("warns once for a message over the limit, naming its procedure and window", () => {
  const { meter, warn } = setup();
  meter.received(request("1", "chats.live.list"));
  meter.sent(response("1", 1.5 * MB));
  expect(warn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "RPC payload: chats.live.list sent 1.5 MB in one message to window 7 (1 message, 1.5 MB in the last minute)",
      ],
    ]
  `);
});

it("warns when a procedure sends over the minute's limit in smaller messages", () => {
  const { meter, warn, advance } = setup();
  meter.received(request("s", "chats.live.list"));
  meter.sent(streamOpens("s"));
  for (let i = 0; i < 24; i++) {
    meter.sent(event("s", "message", 0.4 * MB));
    advance(2_000);
  }
  expect(warn).not.toHaveBeenCalled();
  meter.sent(event("s", "message", 0.4 * MB));
  expect(warn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "RPC payload: chats.live.list sent 10.0 MB in 26 messages to window 7 within a minute",
      ],
    ]
  `);
});

it("forgets what fell out of the rolling minute", () => {
  const { meter, warn, advance } = setup();
  meter.received(request("s", "chats.live.list"));
  meter.sent(streamOpens("s"));
  for (let i = 0; i < 60; i++) {
    meter.sent(event("s", "message", 0.4 * MB));
    advance(10_000);
  }
  expect(warn).not.toHaveBeenCalled();
});

it("warns of each kind at most once an hour per procedure", () => {
  const { meter, warn, advance } = setup({
    messageBytes: MB,
    minuteBytes: 100 * MB,
  });
  meter.received(request("s", "chats.live.list"));
  meter.sent(streamOpens("s"));
  meter.sent(event("s", "message", 2 * MB));
  advance(HOUR - 1);
  meter.sent(event("s", "message", 2 * MB));
  expect(warn).toHaveBeenCalledTimes(1);
  advance(1);
  meter.sent(event("s", "message", 2 * MB));
  expect(warn).toHaveBeenCalledTimes(2);
});

it("shares the hourly limit between windows", () => {
  const gate = createAlarmGate({ now: () => 0 });
  const warn = vi.fn();
  const limits = { messageBytes: MB, minuteBytes: 100 * MB };
  for (const window of [1, 2]) {
    const meter = createPayloadMeter({
      window,
      warn,
      now: () => 0,
      gate,
      limits,
    });
    meter.received(request("1", "chats.live.list"));
    meter.sent(response("1", 2 * MB));
  }
  expect(warn).toHaveBeenCalledTimes(1);
});

it.each([
  ["a response", [response("1")]],
  [
    "a finished stream",
    [streamOpens("1"), event("1", "message"), event("1", "done")],
  ],
  ["a failed stream", [streamOpens("1"), event("1", "error")]],
])("forgets a call after %s", (_, frames) => {
  const { meter } = setup();
  meter.received(request("1", "chats.live.list"));
  for (const frame of frames.slice(0, -1)) {
    meter.sent(frame);
    expect(meter.openCalls()).toBe(1);
  }
  meter.sent(frames.at(-1));
  expect(meter.openCalls()).toBe(0);
});

it("forgets a stream the window aborts, and everything when the port closes", () => {
  const { meter } = setup();
  meter.received(request("1", "chats.live.list"));
  meter.received(request("2", "chats.live.list"));
  meter.sent(streamOpens("1"));
  meter.received(abort("1"));
  expect(meter.openCalls()).toBe(1);
  meter.closed();
  expect(meter.openCalls()).toBe(0);
});

it("follows at most a thousand calls, dropping the one idle longest", () => {
  const { meter, warn } = setup();
  meter.received(request("live", "chats.live.list"));
  meter.sent(streamOpens("live"));
  for (let i = 0; i < 999; i++) {
    meter.received(request(`u${i}`, "files.read"));
  }
  meter.sent(event("live", "message"));
  meter.received(request("one-more", "files.read"));
  expect(meter.openCalls()).toBe(1_000);
  meter.sent(event("live", "message", 2 * MB));
  expect(warn.mock.calls[0]?.[0]).toContain("chats.live.list");
});

it("counts a frame it cannot read without throwing", () => {
  const { meter, warn } = setup();
  for (const frame of [
    "not json",
    42,
    { i: "1" },
    undefined,
    new ArrayBuffer(2 * MB),
  ]) {
    expect(() => {
      meter.sent(frame);
      meter.received(frame);
    }).not.toThrow();
  }
  expect(warn.mock.calls[0]?.[0]).toMatch(
    /^RPC payload: \(unknown\) sent 2\.0 MB/,
  );
});

class FakePort extends EventEmitter {
  other: FakePort | undefined;
  postMessage(data: unknown) {
    const other = this.other;
    queueMicrotask(() => other?.emit("message", { data }));
  }
}

function portPair() {
  const a = new FakePort();
  const b = new FakePort();
  a.other = b;
  b.other = a;
  return [a, b] as const;
}

it("hands the message on unchanged even when counting throws", () => {
  const port = { postMessage: vi.fn(), on: vi.fn() };
  const post = port.postMessage;
  meterRPCPayloads(port, 1, {
    warn: () => {
      throw new Error("log broke");
    },
    now: () => {
      throw new Error("clock broke");
    },
  });
  const frame = response("1", 10);
  expect(() => {
    port.postMessage(frame);
  }).not.toThrow();
  expect(post).toHaveBeenCalledWith(frame);
});

it("attributes real oRPC frames and forgets each call once it ends", async () => {
  const big = "x".repeat(MB);
  const router = {
    chats: {
      live: {
        list: os.handler(async function* () {
          yield big;
          yield big;
        }),
      },
    },
    ping: os.handler(() => "pong"),
  };
  const [clientPort, serverPort] = portPair();
  const warn = vi.fn<(message: string) => void>();
  const meter = meterRPCPayloads(serverPort, 3, {
    warn,
    gate: createAlarmGate(),
  });
  new RPCHandler(router).upgrade(serverPort);
  const client: RouterClient<typeof router> = createORPCClient(
    new RPCLink({ port: clientPort }),
  );

  expect(await client.ping()).toBe("pong");
  expect(meter.openCalls()).toBe(0);

  const seen: string[] = [];
  for await (const value of await client.chats.live.list()) {
    seen.push(value);
    expect(meter.openCalls()).toBe(1);
  }
  expect(seen).toHaveLength(2);
  await vi.waitFor(() => {
    expect(meter.openCalls()).toBe(0);
  });
  expect(warn.mock.calls[0]?.[0]).toMatch(
    /^RPC payload: chats\.live\.list sent 1\.0 MB in one message to window 3/,
  );
});
