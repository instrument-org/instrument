import { describe, expect, it } from "vitest";

import {
  tarProgramArgs,
  tarWithDashedOptions,
  tarWrites,
  tarWritesStdout,
} from "./tar-args";

describe("tarWithDashedOptions", () => {
  it.each<[string[], NodeJS.Platform, string]>([
    [["czf", "out.tgz", "d"], "darwin", "-c -z -f out.tgz d"],
    [["cfz", "out.tgz", "d"], "darwin", "-c -f out.tgz -z d"],
    [["xvf", "a.tar", "-C", "x"], "linux", "-x -v -f a.tar -C x"],
    [["-czf", "out.tgz", "d"], "darwin", "-czf out.tgz d"],
    [["--list", "-f", "a.tar"], "darwin", "--list -f a.tar"],
  ])("%j on %s", (args, platform, expected) => {
    expect(tarWithDashedOptions(args, platform).join(" ")).toBe(expected);
  });
});

describe("tarWrites", () => {
  it.each<[string[], string[]]>([
    [["czf", "out.tgz", "d"], ["out.tgz"]],
    [["-czf", "out.tgz", "d"], ["out.tgz"]],
    [["--create", "--file=out.tar", "d"], ["out.tar"]],
    [["-c", "-f", "out.tar", "-C", "src", "."], ["out.tar"]],
    [["-rf", "a.tar", "b"], ["a.tar"]],
    [["xzf", "a.tgz"], ["."]],
    [["-xzf", "a.tgz", "-C", "x"], ["x"]],
    [["-x", "-f", "a.tar", "--directory=out"], ["out"]],
    [["-xf", "a.tar", "-Cout"], ["out"]],
    [["tzf", "a.tgz"], []],
    [["czf", "-", "d"], []],
  ])("%j writes %j", (args, expected) => {
    expect(tarWrites(args)).toEqual(expected);
  });
});

describe("tarWritesStdout", () => {
  it.each<[string[], boolean]>([
    [["czf", "-", "d"], true],
    [["-cz", "d"], true],
    [["-czf", "out.tgz", "d"], false],
    [["-xzf", "-"], false],
    [["tf", "-"], false],
  ])("%j is %s", (args, expected) => {
    expect(tarWritesStdout(args)).toBe(expected);
  });
});

describe("tarProgramArgs", () => {
  it.each<[string[], string]>([
    [["czf", "out.tgz", "."], "-c -z -f out.tgz ."],
    [["czf", "-", "."], "-c -z -f - ."],
    [["-cz", "."], "-f - -cz ."],
    [["-xf", "a.tar"], "-xf a.tar"],
    [["-tf", "a.tar"], "-tf a.tar"],
  ])("%j becomes %s", (args, expected) => {
    expect(tarProgramArgs(args).join(" ")).toBe(expected);
  });
});
