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
    ['write "x" to f', 'write "" to'],
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

  // An allowed script runs outside the sandbox, so every language feature
  // that runs code is refused, whatever its spelling.
  it.each([
    ['tell application "Mail" to «event sysoexec» "id"', "«event"],
    ['tell application "Mail" to <<event sysoexec>> "id"', "<<event"],
    ['tell application "Mail" to << event sysoexec >> "id"', "<< event"],
    // A Mac Roman file's « as it reads here.
    [
      'tell application "Mail" to \u00c7event sysoexec\u00c8 "id"',
      "\u00c7event",
    ],
    ['tell application "Mail" to get «class NSTa»', "«class"],
    [
      'tell application "Notes" to make new note with properties {body:«data utxt0041»}',
      "«data",
    ],
    ['tell application "Mail" to DO  SHELL\tSCRIPT "id"', "DO SHELL SCRIPT"],
    [
      'set s to load script file "x.scpt"\ntell application "Mail" to activate',
      "load script",
    ],
    [
      'store script s in "x.scpt"\ntell application "Mail" to activate',
      "store script",
    ],
    ['use script "Helpers"\ntell application "Mail" to activate', "use script"],
    [
      'tell script "Helpers" to go\ntell application "Mail" to activate',
      'script "',
    ],
    [
      "set t to current application's NSTask's alloc()'s init()",
      "current application's",
    ],
    [
      "set t to NSTask's alloc()'s init()\ntell application \"Mail\" to activate",
      "NSTask",
    ],
    [
      'open location "file:///Users/sam/run.command"\ntell application "Mail" to activate',
      "open location",
    ],
    [
      "Application.currentApplication().displayDialog('hi')",
      "Application.currentApplication",
    ],
  ])("refuses %j", (source, expected) => {
    expect(runsCodeOutside(source)).toBe(expected);
  });

  it.each([
    'tell application "Notes" to make new note at folder "Notes" with properties {name:"Groceries", body:"Eggs, milk"}',
    'tell application "Notes" to get body of note "Groceries"',
    'tell application "Mail" to get subject of messages 1 thru 5 of inbox',
    'tell application "Mail" to make new outgoing message with properties {subject:"Lunch", content:"See you at <<noon>>, «Bonjour»"}',
    'tell application "Reminders" to make new reminder with properties {name:"Call Sam", due date:(current date) + 3600}',
    'tell application "Reminders" to get name of every reminder whose completed is false',
    'display dialog "All done" buttons {"OK"} default button 1',
  ])("lets %j run", (source) => {
    expect(runsCodeOutside(source)).toBeUndefined();
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
