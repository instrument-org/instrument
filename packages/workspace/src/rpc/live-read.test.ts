import { EventPublisher } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { liveRead, where } from "./live-read";

function setup() {
  const publisher = new EventPublisher<{ changed: { id: string } }>({
    maxBufferedEvents: 1,
  });
  const controller = new AbortController();
  return { controller, publisher, signal: controller.signal };
}

describe("liveRead", () => {
  it("hears a change that lands while the first answer is on its way", async () => {
    const { controller, publisher, signal } = setup();
    let value = "before";
    const answers = liveRead({
      changes: [publisher.subscribe("changed", { signal })],
      read: () => value,
    });

    expect((await answers.next()).value).toBe("before");
    // The consumer has the first answer and has not come back yet.
    value = "after";
    publisher.publish("changed", { id: "a" });

    expect((await answers.next()).value).toBe("after");
    controller.abort();
  });

  it("reads once more for a burst, not once per change", async () => {
    const { controller, publisher, signal } = setup();
    let reads = 0;
    let release: (() => void) | undefined;
    const answers = liveRead({
      changes: [publisher.subscribe("changed", { signal })],
      read: async () => {
        reads += 1;
        if (reads === 2) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return reads;
      },
    });

    await answers.next();
    publisher.publish("changed", { id: "a" });
    const second = answers.next();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Three more land while the second read is under way.
    publisher.publish("changed", { id: "a" });
    publisher.publish("changed", { id: "a" });
    publisher.publish("changed", { id: "a" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    release?.();
    expect((await second).value).toBe(2);
    expect((await answers.next()).value).toBe(3);

    const nothingMore = await Promise.race([
      answers.next().then(() => "read again"),
      new Promise((resolve) => setTimeout(() => resolve("quiet"), 20)),
    ]);
    expect(nothingMore).toBe("quiet");
    controller.abort();
  });

  it("reads again only for the changes `where` keeps", async () => {
    const { controller, publisher, signal } = setup();
    let reads = 0;
    const answers = liveRead({
      changes: [
        where(
          publisher.subscribe("changed", { signal }),
          ({ id }) => id === "mine",
        ),
      ],
      read: () => (reads += 1),
    });

    await answers.next();
    publisher.publish("changed", { id: "theirs" });
    publisher.publish("changed", { id: "mine" });

    expect((await answers.next()).value).toBe(2);
    controller.abort();
  });
});
