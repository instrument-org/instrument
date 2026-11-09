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

const LIMITS = {
  messageBytes: MB,
  minuteBytes: 10 * MB,
  largeBytes: 256_000,
  largeMessages: 10,
  procedureStreams: 50,
  windowStreams: 200,
};

function setup(limits: Partial<typeof LIMITS> = {}) {
  let clock = 0;
  const now = () => clock;
  const warn = vi.fn<(message: string) => void>();
  const meter = createPayloadMeter({
    window: 7,
    warn,
    now,
    gate: createAlarmGate({ now }),
    limits: { ...LIMITS, ...limits },
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
  const { meter, warn, advance } = setup({ largeMessages: 100 });
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
  const { meter, warn, advance } = setup({ minuteBytes: 100 * MB });
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
  const limits = { ...LIMITS, minuteBytes: 100 * MB };
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

it("warns when a procedure sends more than ten large messages within a minute", () => {
  const { meter, warn, advance } = setup();
  meter.received(request("s", "chats.live.list"));
  meter.sent(streamOpens("s"));
  for (let i = 0; i < 10; i++) {
    meter.sent(event("s", "message", (i === 3 ? 420 : 300) * 1_000));
    meter.sent(event("s", "message", 200_000));
    advance(5_000);
  }
  expect(warn).not.toHaveBeenCalled();
  meter.sent(event("s", "message", 300_000));
  expect(warn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "RPC payload: chats.live.list sent 11 messages over 256 KB to window 7 within a minute (largest 420 KB)",
      ],
    ]
  `);
});

it("counts large messages over a rolling minute, once an hour", () => {
  const { meter, warn, advance } = setup({ minuteBytes: 100 * MB });
  meter.received(request("s", "chats.live.list"));
  meter.sent(streamOpens("s"));
  for (let i = 0; i < 30; i++) {
    meter.sent(event("s", "message", 300_000));
    advance(6_000);
  }
  expect(warn).not.toHaveBeenCalled();
  for (let i = 0; i < 30; i++) {
    meter.sent(event("s", "message", 300_000));
    advance(1_000);
  }
  expect(warn.mock.calls[0]?.[0]).toMatch(/sent 11 messages over 256 KB/);
  advance(30 * 60_000);
  for (let i = 0; i < 30; i++) {
    meter.sent(event("s", "message", 300_000));
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

it("follows at most a thousand unanswered calls, keeping streams apart", () => {
  const { meter, warn } = setup();
  meter.received(request("live", "chats.live.list"));
  meter.sent(streamOpens("live"));
  for (let i = 0; i < 1_001; i++) {
    meter.received(request(`u${i}`, "files.read"));
  }
  expect(meter.openCalls()).toBe(1_001);
  meter.sent(event("live", "message", 2 * MB));
  meter.sent(response("u0", 2 * MB));
  expect(warn.mock.calls.map(([line]) => line.split(" sent")[0])).toEqual([
    "RPC payload: chats.live.list",
    "RPC payload: (unknown)",
  ]);
});

let next = 0;
function openStreams(
  meter: ReturnType<typeof setup>["meter"],
  path: string,
  count: number,
) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `${path}-${next++}`;
    meter.received(request(id, path));
    meter.sent(streamOpens(id));
    ids.push(id);
  }
  return ids;
}

it("warns when one procedure has more than fifty streams open in a window, once an hour", () => {
  const { meter, warn, advance } = setup();
  const ids = openStreams(meter, "chats.transcript.live", 50);
  expect(warn).not.toHaveBeenCalled();
  openStreams(meter, "chats.transcript.live", 1);
  expect(warn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "RPC streams: chats.transcript.live has 51 streams open to window 7 (51 open in all)",
      ],
    ]
  `);
  for (const id of ids.slice(0, 20)) {
    meter.sent(event(id, "done"));
  }
  advance(HOUR - 1);
  openStreams(meter, "chats.transcript.live", 30);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(meter.openStreams()).toBe(61);
});

it("warns as a window's open streams climb past 200 and each doubling", () => {
  const { meter, warn } = setup({ procedureStreams: 1_000 });
  openStreams(meter, "a.live", 120);
  const b = openStreams(meter, "b.live", 80);
  openStreams(meter, "c.live", 1);
  openStreams(meter, "c.live", 1);
  expect(warn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "RPC streams: window 7 has 201 streams open, past 200 (most: a.live 120, b.live 80, c.live 1)",
      ],
    ]
  `);
  for (const id of b) {
    meter.received(abort(id));
  }
  openStreams(meter, "a.live", 80);
  expect(warn).toHaveBeenCalledTimes(1);
  openStreams(meter, "a.live", 198);
  expect(meter.openStreams()).toBe(400);
  expect(warn).toHaveBeenCalledTimes(1);
  openStreams(meter, "a.live", 1);
  expect(warn.mock.calls[1]?.[0]).toMatchInlineSnapshot(
    `"RPC streams: window 7 has 401 streams open, past 400 (most: a.live 399, c.live 2)"`,
  );
});

it("counts a stream as open until it ends, however it ends", () => {
  const { meter } = setup();
  const [done = "", failed = "", aborted = ""] = openStreams(
    meter,
    "x.live",
    4,
  );
  meter.sent(event(done, "message"));
  expect(meter.openStreams()).toBe(4);
  meter.sent(event(done, "done"));
  meter.sent(event(failed, "error"));
  meter.received(abort(aborted));
  expect(meter.openStreams()).toBe(1);
  meter.received(request("plain", "x.get"));
  meter.sent(response("plain"));
  expect(meter.openStreams()).toBe(1);
  meter.closed();
  expect(meter.openStreams()).toBe(0);
});

it("keeps counting a stream past the cap as open, since nothing said it ended", () => {
  const { meter } = setup({ procedureStreams: 10_000 });
  const [first = "", second = ""] = openStreams(meter, "x.live", 4_001);
  expect(meter.openStreams()).toBe(4_001);
  meter.sent(event(first, "done"));
  expect(meter.openStreams()).toBe(4_001);
  meter.sent(event(second, "done"));
  expect(meter.openStreams()).toBe(4_000);
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

it("hands the message on unchanged even when the warning throws", () => {
  const port = { postMessage: vi.fn(), on: vi.fn() };
  const post = port.postMessage;
  const warn = vi.fn(() => {
    throw new Error("log broke");
  });
  meterRPCPayloads(port, 1, { warn, gate: createAlarmGate() });
  const frame = response("1", 2 * MB);
  expect(() => {
    port.postMessage(frame);
  }).not.toThrow();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith(frame);
});

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
