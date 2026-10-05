import { EMPTY_BYTES, InMemoryFs } from "just-bash";
import { describe, expect, it } from "vitest";

import { defineSubcommands, subcommand } from "./subcommands";

const shell = { cwd: "/task", fs: new InMemoryFs(), stdin: EMPTY_BYTES };

/** A command whose one subcommand prints what it was handed. */
const run = defineSubcommands<undefined>({
  name: "demo",
  subcommands: {
    go: subcommand({
      booleans: ["steps"],
      flags: ["folder", "n", "name", "tail"],
      positional: 2,
      repeatable: ["folder"],
      run: (input) =>
        `${JSON.stringify({
          folder: input.all("folder"),
          n: input.value("n"),
          name: input.value("name"),
          positional: input.positional,
          steps: input.has("steps"),
        })}\n`,
      usage: "  demo go [--name <name>]\n",
    }),
    refuse: subcommand({
      run: () => {
        throw new Error("no, and here is why.");
      },
    }),
  },
  usage: "Usage: demo go | demo refuse\n",
});

describe("defineSubcommands", () => {
  it("reads spaced and inline values, keeps the last of a flag given twice, and collects a repeatable one", async () => {
    const result = await run(
      [
        "go",
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
      ],
      undefined,
      shell,
    );
    expect(JSON.parse(result.stdout)).toEqual({
      folder: ["Home", "Instrument:rw"],
      n: "3",
      name: "Porto",
      positional: ["the", "brief"],
      steps: true,
    });
  });

  // A misspelled flag read as a word would land in a brief, or name a task.
  it("refuses a flag it was not told about, with the subcommand's usage", async () => {
    const result = await run(["go", "--nam", "x"], undefined, shell);
    expect(result).toEqual({
      exitCode: 1,
      stderr:
        "demo: unknown flag --nam on `demo go`.\n\n  demo go [--name <name>]\n\n",
      stdout: "",
    });
  });

  it("takes everything after -- as a word, and a lone dash and digit as one", async () => {
    const result = await run(["go", "-5", "--", "--steps"], undefined, shell);
    const printed: unknown = JSON.parse(result.stdout);
    expect(printed).toMatchObject({ positional: ["-5", "--steps"] });
  });

  it.each([
    [["go", "--tail"], "demo: --tail needs a value."],
    [["go", "a", "b", "c"], 'demo: unexpected argument "c" on `demo go`.'],
    [["frob"], 'demo: unknown subcommand "frob".'],
    [["refuse"], "demo: no, and here is why."],
  ])("refuses %j on stderr with exit 1", async (args, message) => {
    const result = await run(args, undefined, shell);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.split("\n")[0]).toBe(message);
  });

  it.each([[[]], [["help"]], [["go", "--help"]], [["-h"]]])(
    "prints the usage for %j",
    async (args) => {
      expect(await run(args, undefined, shell)).toEqual({
        exitCode: 0,
        stderr: "",
        stdout: "Usage: demo go | demo refuse\n",
      });
    },
  );
});
