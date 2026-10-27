import { describe, expect, it } from "vitest";

import { parseArgs } from "./argv";

const spec = {
  booleans: ["steps"],
  flags: ["folder", "n", "name", "tail"],
  positional: 2,
  repeatable: ["folder"],
};
const where = { form: "  demo go [--name <name>]", name: "demo go" };

function parsed(args: string[]) {
  const input = parseArgs(spec, args, where);
  return {
    folder: input.all("folder"),
    n: input.value("n"),
    name: input.value("name"),
    positional: input.positional,
    steps: input.has("steps"),
  };
}

describe("parseArgs", () => {
  it("reads spaced and inline values, keeps the last of a flag given twice, and collects a repeatable one", () => {
    expect(
      parsed([
        "--name",
        "Lisbon",
        "--folder",
        "Home",
        "--folder=Instrument:rw",
        "--name=Porto",
        "-n",
        "3",
        "--steps",
        "the",
        "brief",
      ]),
    ).toEqual({
      folder: ["Home", "Instrument:rw"],
      n: "3",
      name: "Porto",
      positional: ["the", "brief"],
      steps: true,
    });
  });

  // A misspelled flag read as a word would land in a brief, or name a task.
  it("refuses a flag it was not told about, with the form it takes", () => {
    expect(() => parsed(["--nam", "x"])).toThrow(
      "unknown flag --nam on `demo go`.\n\n  demo go [--name <name>]",
    );
  });

  it("takes everything after -- as a word, and a lone dash and digit as one", () => {
    expect(parsed(["-5", "--", "--steps"]).positional).toEqual([
      "-5",
      "--steps",
    ]);
  });

  it.each([
    [["--tail"], "--tail needs a value."],
    [["a", "b", "c"], 'unexpected argument "c" on `demo go`.'],
  ])("refuses %j", (args, message) => {
    expect(() => parsed(args)).toThrow(message);
  });
});
