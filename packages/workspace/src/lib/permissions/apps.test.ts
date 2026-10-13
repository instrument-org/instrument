import { describe, expect, it } from "vitest";

import { reachesEveryFile, runsCodeOutside, scriptTargets } from "./apps";

describe("scriptTargets", () => {
  it.each([
    ['tell application "Mail" to count messages of inbox', ["Mail"]],
    [
      'tell app "Notes"\n  tell application "notes" to count notes\nend tell',
      ["Notes"],
    ],
    ['tell application id "com.apple.mail" to activate', ["com.apple.mail"]],
    ["Application('Music').play()", ["Music"]],
    ["return 1 + 1", []],
  ])("%s", (source, expected) => {
    expect(scriptTargets(source)).toEqual(expected);
  });
});

describe("runsCodeOutside", () => {
  it.each([
    [
      'tell application "Mail" to do shell script "cat ~/.ssh/id_test"',
      "do shell script",
    ],
    [
      "app = Application.currentApplication(); app.doShellScript('id')",
      "doShellScript",
    ],
    ['run script "do shell" & " script"', "run script"],
    ['use framework "Foundation"', "use framework"],
    ["ObjC.import('Foundation')", "ObjC."],
    ["$.NSTask.alloc", "$."],
    ['tell application "Mail" to count messages of inbox', undefined],
    ["Application('Music').play()", undefined],
    ['read POSIX file "/Users/sam/.ssh/id_test"', "read P"],
    ["set f to open for access p with write permission", "open for access"],
    ['write "x" to f', "write \"\" to"],
    ['set n to "Terminal"\ntell application n to activate', "application n"],
    ["Application(name).activate()", "Application(n"],
    ["app.includeStandardAdditions = true", "includeStandardAdditions"],
    [
      'tell application "Notes" to make new note with properties {body:"read this and write back to me"}',
      undefined,
    ],
    ['tell application "Mail" to set read status of m to true', undefined],
    ["tell current application to activate", undefined],
  ])("%s", (source, expected) => {
    expect(runsCodeOutside(source)).toBe(expected);
  });
});

it.each([
  ["Finder", true],
  ["system events", true],
  ["Terminal", true],
  ["Mail", false],
])("%s reaches every file: %s", (app, expected) => {
  expect(reachesEveryFile(app)).toBe(expected);
});
