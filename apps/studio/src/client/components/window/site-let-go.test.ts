import { describe, expect, it } from "vitest";

import { sitesLeaving, sitesNoLongerHere, sitesPutAway } from "./site-let-go";

describe("the sites a window stopped standing on", () => {
  it("are only ones it held, with no tab open here on them", () => {
    expect(
      sitesNoLongerHere(
        ["still-open", "gone", "someone-elses"],
        new Set(["still-open"]),
        new Set(["still-open", "gone"]),
      ),
    ).toEqual(["gone"]);
  });
});

describe("the sites whose pages go", () => {
  const noMoves = () => false;

  it("are those nothing else stands on", () => {
    expect(sitesLeaving(["a"], new Set(), noMoves)).toEqual(["a"]);
  });

  it("are not those another window's tab stands on", () => {
    expect(sitesLeaving(["a"], new Set(["a"]), noMoves)).toEqual([]);
  });

  it("are not those a tab went to another window with, before that window says so", () => {
    expect(sitesLeaving(["a"], new Set(), (group) => group === "a")).toEqual(
      [],
    );
  });
});

describe("what is put aside for a closed tab", () => {
  const recordOf = (group: string) => [`record of ${group}`];
  const putAway = (
    current: Record<string, string[]>,
    {
      noLongerHere = [] as string[],
      open = [] as string[],
      reopenable = [] as string[],
    },
  ) =>
    sitesPutAway(current, {
      noLongerHere,
      open: new Set(open),
      recordOf,
      reopenable: new Set(reopenable),
    });

  it("takes a site a closed tab here stands on", () => {
    expect(putAway({}, { noLongerHere: ["a"], reopenable: ["a"] })).toEqual({
      a: ["record of a"],
    });
  });

  it("takes nothing for a site no closed tab can bring back", () => {
    expect(putAway({}, { noLongerHere: ["a"] })).toEqual({});
  });

  it("keeps what it took once the site has gone, since the record is all there is", () => {
    expect(putAway({ a: ["kept"] }, { reopenable: ["a"] })).toEqual({
      a: ["kept"],
    });
  });

  it("keeps it for a tab open again and on its way there", () => {
    expect(putAway({ a: ["kept"] }, { open: ["a"] })).toEqual({ a: ["kept"] });
  });

  it("lets it go once nothing can come back to it", () => {
    expect(putAway({ a: ["kept"] }, {})).toEqual({});
  });
});
