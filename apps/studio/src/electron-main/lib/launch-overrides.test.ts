import { describe, expect, it } from "vitest";

import { parseLaunchOverrides } from "./launch-overrides";

describe("parseLaunchOverrides", () => {
  it("reads the setting", () => {
    expect(
      parseLaunchOverrides(
        JSON.stringify({ "disable-hardware-acceleration": true }),
      ),
    ).toEqual({
      overrides: { disableHardwareAcceleration: true },
      problems: [],
    });
  });

  it("treats an empty object as no overrides", () => {
    expect(parseLaunchOverrides("{}")).toEqual({
      overrides: { disableHardwareAcceleration: false },
      problems: [],
    });
  });

  // A file the app cannot read is a file the user typed by hand and got wrong.
  // It runs before there is a window to say so in, so every one of these has to
  // end in the app starting anyway.
  it.each([
    { contents: "", name: "empty" },
    { contents: "{", name: "truncated" },
    { contents: "not json at all", name: "not JSON" },
  ])("starts anyway when the file is $name", ({ contents }) => {
    const { overrides, problems } = parseLaunchOverrides(contents);

    expect(overrides).toEqual({ disableHardwareAcceleration: false });
    expect(problems).toMatchInlineSnapshot(`
      [
        "launch-overrides.json is not valid JSON",
      ]
    `);
  });

  it.each([
    { contents: "[]", name: "an array" },
    { contents: "null", name: "null" },
    { contents: '"true"', name: "a bare string" },
  ])("rejects $name as the whole file", ({ contents }) => {
    expect(parseLaunchOverrides(contents).problems).toMatchInlineSnapshot(`
      [
        "launch-overrides.json is not an object",
      ]
    `);
  });

  // Reported rather than coerced, because a user who wrote "yes" meant to turn
  // this on and silently leaving it off would look like the file did nothing.
  it.each([
    { name: "a string", value: "yes" },
    { name: "a number", value: 1 },
    { name: "null", value: null },
  ])("reports $name where a boolean belongs", ({ value }) => {
    const { overrides, problems } = parseLaunchOverrides(
      JSON.stringify({ "disable-hardware-acceleration": value }),
    );

    expect(overrides.disableHardwareAcceleration).toBe(false);
    expect(problems).toMatchInlineSnapshot(`
      [
        "disable-hardware-acceleration must be true or false",
      ]
    `);
  });

  // Room for a second setting later without a file written for that future
  // version being rejected wholesale by this one.
  it("ignores keys it does not know", () => {
    const { overrides, problems } = parseLaunchOverrides(
      JSON.stringify({
        "disable-hardware-acceleration": true,
        somethingElse: 42,
      }),
    );

    expect(overrides.disableHardwareAcceleration).toBe(true);
    expect(problems).toEqual([]);
  });
});
