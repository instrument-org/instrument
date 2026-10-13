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
    ['set lib to load script file "Lib.scpt"', "load script"],
    ['store script s in file "Lib.scpt"', "store script"],
    ['use framework "Foundation"', "use framework"],
    [
      "current application's NSFileManager's defaultManager()",
      "current application's",
    ],
    ['set h to system attribute "HOME"', "system attribute"],
    ["ObjC.import('Foundation')", "ObjC."],
    ["$.NSTask.alloc", "$."],
    ["$('id')", "$("],
    ["eval('1 + 1')", "eval("],
    ["Function('return 1')()", "Function("],
    ['tell application "Mail" to count messages of inbox', undefined],
    ["Application('Music').play()", undefined],
    [
      'read POSIX file "/Users/sam/.ssh/id_test"',
      'read POSIX file "/Users/sam/.ssh/id_test"',
    ],
    [
      'set t to read file "Macintosh HD:Users:sam:notes.txt" as «class utf8»',
      'read file "Macintosh HD:Users:sam:notes.txt"',
    ],
    [
      'read alias "Macintosh HD:etc:hosts"',
      'read alias "Macintosh HD:etc:hosts"',
    ],
    ['read "/etc/hosts"', 'read "/etc/hosts"'],
    ["set t to read theFile as «class utf8»", "read theFile"],
    ["read (POSIX file p)", "read (POSIX file p)"],
    ["set f to open for access p with write permission", "open for access"],
    ['write "x" to f', 'write "x" to'],
    ['set n to "Terminal"\ntell application n to activate', "application n"],
    ["tell application appName to activate", "application appName"],
    ["tell app (item 1 of names) to activate", "app (item 1 of names)"],
    ["tell application id bundleId to activate", "application id bundleId"],
    ["Application(name).activate()", "Application(name)"],
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
