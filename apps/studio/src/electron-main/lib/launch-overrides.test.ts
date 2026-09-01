import { describe, expect, it } from "vitest";

import { parseLaunchOverrides } from "./launch-overrides";

describe("parseLaunchOverrides", () => {
  it("reads both settings", () => {
    expect(
      parseLaunchOverrides(
        JSON.stringify({
          "disable-hardware-acceleration": true,
          "ozone-platform": "x11",
        }),
      ),
    ).toEqual({
      overrides: { disableHardwareAcceleration: true, ozonePlatform: "x11" },
      problems: [],
    });
  });

  it("treats an empty object as no overrides", () => {
    expect(parseLaunchOverrides("{}")).toEqual({
      overrides: {
        disableHardwareAcceleration: false,
        ozonePlatform: undefined,
      },
      problems: [],
    });
  });

  // The platform name is passed through rather than checked here, so that the
  // file and the environment variable are validated by the same function and
  // cannot come to different conclusions about the same string.
  it("passes an unknown platform name through to be validated later", () => {
    const { overrides, problems } = parseLaunchOverrides(
      JSON.stringify({ "ozone-platform": "nonsense" }),
    );

    expect(overrides.ozonePlatform).toBe("nonsense");
    expect(problems).toEqual([]);
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

    expect(overrides).toEqual({
      disableHardwareAcceleration: false,
      ozonePlatform: undefined,
    });
    expect(problems).toMatchInlineSnapshot(`
      [
        "launch-overrides.json is not valid JSON",
      ]
    `);
  });

  it.each([
    { contents: "[]", name: "an array" },
    { contents: "null", name: "null" },
    { contents: '"x11"', name: "a bare string" },
  ])("rejects $name as the whole file", ({ contents }) => {
    expect(parseLaunchOverrides(contents).problems).toMatchInlineSnapshot(`
      [
        "launch-overrides.json is not an object",
      ]
    `);
  });

  // One key of the wrong type must not discard the other, because the two are
  // set for unrelated reasons and a user fixing graphics should not silently
  // lose the display protocol they set last month.
  it("keeps the usable key and reports the other", () => {
    const { overrides, problems } = parseLaunchOverrides(
      JSON.stringify({
        "disable-hardware-acceleration": "yes",
        "ozone-platform": "wayland",
      }),
    );

    expect(overrides.ozonePlatform).toBe("wayland");
    expect(overrides.disableHardwareAcceleration).toBe(false);
    expect(problems).toMatchInlineSnapshot(`
      [
        "disable-hardware-acceleration must be true or false",
      ]
    `);
  });

  it("reports every unusable key", () => {
    expect(
      parseLaunchOverrides(
        JSON.stringify({
          "disable-hardware-acceleration": 1,
          "ozone-platform": false,
        }),
      ).problems,
    ).toMatchInlineSnapshot(`
      [
        "ozone-platform must be a string",
        "disable-hardware-acceleration must be true or false",
      ]
    `);
  });

  it("ignores keys it does not know", () => {
    const { overrides, problems } = parseLaunchOverrides(
      JSON.stringify({ "ozone-platform": "x11", somethingElse: 42 }),
    );

    expect(overrides.ozonePlatform).toBe("x11");
    expect(problems).toEqual([]);
  });
});
