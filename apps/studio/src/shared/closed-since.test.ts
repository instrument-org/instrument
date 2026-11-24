import { describe, expect, it } from "vitest";

import { closedSince, TabsModelSchema } from "./tabs";

describe("closedSince", () => {
  const { recentlyClosed } = TabsModelSchema.parse({
    recentlyClosed: [300, 200, undefined].map((closedAt, index) => ({
      ...(closedAt === undefined ? {} : { closedAt }),
      id: `t${index}`,
      pathname: "/",
    })),
    selectedId: null,
    tabs: [],
  });

  it.each([
    [undefined, [true, true, true]],
    [200, [true, true, false]],
    [250, [true, false, false]],
  ])(
    "from %s, takes what closed then or later, and an untimed one only for all time",
    (since, taken) => {
      expect(recentlyClosed.map((each) => closedSince(each, since))).toEqual(
        taken,
      );
    },
  );
});
