import { expect, it } from "vitest";

import { homeSpellings } from "./home-folder";

it("spells a Windows home every way it shows up, longest first", () => {
  expect(homeSpellings("C:\\Users\\sam")).toMatchInlineSnapshot(`
    [
      "C:\\\\Users\\\\sam",
      "c:\\\\Users\\\\sam",
      "C:\\Users\\sam",
      "C:/Users/sam",
      "/C/Users/sam",
      "c:\\Users\\sam",
      "c:/Users/sam",
      "/c/Users/sam",
    ]
  `);
});

it("leaves a macOS or Linux home as it is", () => {
  expect(homeSpellings("/Users/sam")).toEqual(["/Users/sam"]);
  expect(homeSpellings("")).toEqual([]);
});
