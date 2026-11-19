import { describe, expect, it, vi } from "vitest";

import {
  createHostedLimiter,
  type HostedLimiterClock,
  type HostedLimits,
  type HostedRelease,
  releaseWhenBodyEnds,
} from "./hosted-limiter";

/** A clock that moves only when told to, running what came due. */
function fakeClock() {
  let time = 0;
  let timers: { at: number; run: () => void }[] = [];
  const clock: HostedLimiterClock = {
    now: () => time,
    schedule: (run, ms) => {
      const timer = { at: time + ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((other) => other !== timer);
      };
    },
  };
  return {
    advance: async (ms: number) => {
      const until = time + ms;
      for (;;) {
        const due = timers
          .filter((timer) => timer.at <= until)
          .toSorted((a, b) => a.at - b.at)[0];
        if (!due) {
          break;
        }
        timers = timers.filter((timer) => timer !== due);
        time = due.at;
        due.run();
        await settle();
      }
      time = until;
      await settle();
    },
    clock,
  };
}

/** Lets resolved acquisitions reach their callers. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function limiterWith(limits: HostedLimits) {
  const time = fakeClock();
  const limiter = createHostedLimiter({ clock: time.clock, limits });
  const order: string[] = [];
  const releases = new Map<string, HostedRelease>();
  /** Asks for a slot as `name`, noting when it is granted. */
  const ask = (
    name: string,
    key: string,
    options: { lane?: "agent" | "priority"; signal?: AbortSignal } = {},
  ) =>
    limiter.acquire({ key, ...options }).then((release) => {
      order.push(name);
      releases.set(name, release);
    });
  const release = async (name: string, refusal?: string) => {
    releases.get(name)?.(refusal ? { refusal } : undefined);
    await settle();
  };
  return { ask, limiter, order, release, time };
}

describe("HostedLimiter", () => {
  it("lets no more than the plan's limit run, one slot kept for the priority lane", async () => {
    const { ask, limiter, order } = limiterWith({
      maxInFlight: 4,
      perMinute: 300,
    });
    for (const name of ["a1", "a2", "a3", "a4", "a5"]) {
      void ask(name, "a");
    }
    await settle();

    expect(order).toEqual(["a1", "a2", "a3"]);
    expect(limiter.snapshot()).toEqual({ ceiling: 4, inFlight: 3, queued: 2 });

    void ask("dictation", "dictation", { lane: "priority" });
    await settle();

    expect(order).toEqual(["a1", "a2", "a3", "dictation"]);
  });

  it("serves the waiting chats in turn, so one chat's fan-out takes one turn", async () => {
    const { ask, order, release } = limiterWith({
      maxInFlight: 2,
      perMinute: 300,
    });
    void ask("busy", "other");
    for (const name of ["a1", "a2", "a3"]) {
      void ask(name, "a");
    }
    void ask("b1", "b");
    void ask("c1", "c");
    await settle();
    expect(order).toEqual(["busy"]);

    for (const name of ["busy", "a1", "b1", "c1", "a2"]) {
      await release(name);
    }

    expect(order).toEqual(["busy", "a1", "b1", "c1", "a2", "a3"]);
  });

  it("puts the priority lane ahead of every waiting chat", async () => {
    const { ask, order, release } = limiterWith({
      maxInFlight: 2,
      perMinute: 300,
    });
    void ask("a1", "a");
    void ask("dictation", "", { lane: "priority" });
    void ask("a2", "a");
    void ask("decision", "", { lane: "priority" });
    await settle();
    expect(order).toEqual(["a1", "dictation"]);

    await release("dictation");
    expect(order).toEqual(["a1", "dictation", "decision"]);
    await release("decision");
    await release("a1");
    expect(order).toEqual(["a1", "dictation", "decision", "a2"]);
  });

  it("paces agent work at 90% of the per-minute limit", async () => {
    const { ask, order, release, time } = limiterWith({
      maxInFlight: 8,
      perMinute: 10,
    });
    for (let index = 0; index < 11; index += 1) {
      const name = `s${index}`;
      void ask(name, "a").then(() => release(name));
    }
    await settle();
    expect(order).toHaveLength(9);

    await time.advance(59_999);
    expect(order).toHaveLength(9);
    await time.advance(1);
    expect(order).toHaveLength(11);
  });

  it("does not pace the priority lane", async () => {
    const { ask, order, release } = limiterWith({
      maxInFlight: 8,
      perMinute: 1,
    });
    for (let index = 0; index < 3; index += 1) {
      const name = `dictation${index}`;
      void ask(name, "", { lane: "priority" }).then(() => release(name));
    }
    await settle();

    expect(order).toHaveLength(3);
  });

  it("takes an aborted wait out of the queue and rejects it as aborted", async () => {
    const { ask, limiter, order, release } = limiterWith({
      maxInFlight: 1,
      perMinute: 300,
    });
    void ask("first", "a");
    const controller = new AbortController();
    const waiting = ask("canceled", "b", { signal: controller.signal });
    void ask("next", "c");
    await settle();

    controller.abort();

    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(limiter.snapshot().queued).toBe(1);
    await release("first");
    expect(order).toEqual(["first", "next"]);
  });

  it("refuses at once a request whose signal has already aborted", async () => {
    const { limiter } = limiterWith({ maxInFlight: 1, perMinute: 300 });

    await expect(
      limiter.acquire({ key: "a", signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(limiter.snapshot()).toEqual({ ceiling: 1, inFlight: 0, queued: 0 });
  });

  it("frees a slot once, however often it is released", async () => {
    const { ask, limiter, release } = limiterWith({
      maxInFlight: 3,
      perMinute: 300,
    });
    void ask("a1", "a");
    void ask("a2", "a");
    await settle();

    await release("a1");
    await release("a1");

    expect(limiter.snapshot().inFlight).toBe(1);
  });

  it("runs one fewer after a concurrency refusal, and one more per clean release up to the limit", async () => {
    const { ask, limiter, order, release } = limiterWith({
      maxInFlight: 5,
      perMinute: 300,
    });
    for (const name of ["a1", "a2", "a3", "a4", "a5", "a6"]) {
      void ask(name, name);
    }
    await settle();
    expect(order).toEqual(["a1", "a2", "a3", "a4"]);

    await release("a4", "concurrency-limit");
    expect(limiter.snapshot()).toMatchObject({ ceiling: 3, inFlight: 3 });
    expect(order).toHaveLength(4);

    await release("a1");
    expect(limiter.snapshot()).toMatchObject({ ceiling: 4, inFlight: 3 });
    expect(order).toEqual(["a1", "a2", "a3", "a4", "a5"]);

    await release("a2");
    await release("a3");
    expect(limiter.snapshot().ceiling).toBe(5);
    expect(order).toEqual(["a1", "a2", "a3", "a4", "a5", "a6"]);
  });

  it("never lowers the limit below one", async () => {
    const { ask, limiter, release } = limiterWith({
      maxInFlight: 2,
      perMinute: 300,
    });
    void ask("a1", "a");
    await settle();

    await release("a1", "concurrency-limit");

    expect(limiter.snapshot().ceiling).toBe(1);
  });

  it("pauses agent work for ten seconds after a rate-limit refusal", async () => {
    const { ask, order, release, time } = limiterWith({
      maxInFlight: 4,
      perMinute: 300,
    });
    void ask("a1", "a");
    await settle();
    await release("a1", "rate-limit-exceeded");

    void ask("a2", "a");
    void ask("dictation", "", { lane: "priority" });
    await settle();
    expect(order).toEqual(["a1", "dictation"]);

    await time.advance(9_999);
    expect(order).toEqual(["a1", "dictation"]);
    await time.advance(1);
    expect(order).toEqual(["a1", "dictation", "a2"]);
  });

  it("does not pause agent work for the priority lane's own rate refusal", async () => {
    const { ask, order, release } = limiterWith({
      maxInFlight: 4,
      perMinute: 300,
    });
    void ask("dictation", "", { lane: "priority" });
    await settle();
    await release("dictation", "rate-limit-exceeded");

    void ask("a1", "a");
    await settle();

    expect(order).toEqual(["dictation", "a1"]);
  });

  it("takes new limits from the billing status, letting waiting work run", async () => {
    const { ask, limiter, order } = limiterWith({
      maxInFlight: 2,
      perMinute: 300,
    });
    for (const name of ["a1", "a2", "a3"]) {
      void ask(name, name);
    }
    await settle();
    expect(order).toEqual(["a1"]);

    limiter.setLimits({ maxInFlight: 24, perMinute: 300 });
    await settle();

    expect(order).toEqual(["a1", "a2", "a3"]);
    expect(limiter.snapshot().ceiling).toBe(24);
  });
});

describe("releaseWhenBodyEnds", () => {
  const streamed = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start: (controller) => {
          controller.enqueue(new TextEncoder().encode("data: one\n\n"));
          controller.enqueue(new TextEncoder().encode("data: two\n\n"));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" }, status: 200 },
    );

  it("holds the slot until the body has been read to the end", async () => {
    const release = vi.fn<HostedRelease>();
    const response = releaseWhenBodyEnds(streamed(), release);

    expect(release).not.toHaveBeenCalled();
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toBe("data: one\n\ndata: two\n\n");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("frees the slot when the reader cancels the body", async () => {
    const release = vi.fn<HostedRelease>();
    const response = releaseWhenBodyEnds(streamed(), release);
    const reader = response.body?.getReader();
    await reader?.read();

    await reader?.cancel();

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("frees the slot when the body fails", async () => {
    const release = vi.fn<HostedRelease>();
    const failing = new Response(
      new ReadableStream<Uint8Array>({
        pull: (controller) => {
          controller.error(new Error("connection reset"));
        },
      }),
    );

    await expect(releaseWhenBodyEnds(failing, release).text()).rejects.toThrow(
      "connection reset",
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("frees the slot when the client's request aborts", () => {
    const release = vi.fn<HostedRelease>();
    const controller = new AbortController();
    releaseWhenBodyEnds(streamed(), release, controller.signal);

    controller.abort();

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("frees the slot at once for a response with no body", () => {
    const release = vi.fn<HostedRelease>();

    releaseWhenBodyEnds(new Response(null, { status: 204 }), release);

    expect(release).toHaveBeenCalledTimes(1);
  });
});
