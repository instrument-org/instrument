import { expect, it, vi } from "vitest";

import { finishAllBeforeLeaving, finishBeforeLeaving } from "./before-leaving";

it("runs each waiting job once and waits for the ones that answer later", async () => {
  const order: string[] = [];
  let land = () => {};
  finishBeforeLeaving(() => {
    order.push("sync");
  });
  finishBeforeLeaving(
    () =>
      new Promise<void>((resolve) => {
        land = () => {
          order.push("landed");
          resolve();
        };
      }),
  );
  finishBeforeLeaving(() => {
    throw new Error("one job failing leaves the rest to run");
  });
  const finished = finishAllBeforeLeaving().then(() => order.push("finished"));
  await Promise.resolve();
  expect(order).toEqual(["sync"]);
  land();
  await finished;
  expect(order).toEqual(["sync", "landed", "finished"]);

  await finishAllBeforeLeaving();
  expect(order).toHaveLength(3);
});

it("skips a job taken back before the window goes", async () => {
  const job = vi.fn();
  const leave = finishBeforeLeaving(job);
  leave();
  await finishAllBeforeLeaving();
  expect(job).not.toHaveBeenCalled();
});
