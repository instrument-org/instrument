import { expect, it } from "vitest";

import { windowsBuild, windowsName } from "./windows-version";

it.each([
  ["10.0.26200", "Windows 11", 26_200],
  ["10.0.22000", "Windows 11", 22_000],
  ["10.0.21999", "Windows 10", 21_999],
  ["10.0.19045", "Windows 10", 19_045],
  ["10.0", "Windows 10.0", undefined],
  ["6.3.9600", "Windows 6.3.9600", undefined],
])("names %s as %s", (version, name, build) => {
  expect(windowsName(version)).toBe(name);
  expect(windowsBuild(version)).toBe(build);
});
