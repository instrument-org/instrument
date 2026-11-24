import { afterEach, describe, expect, it, vi } from "vitest";

import {
  runningScriptAnswerExpression,
  runningScriptAskedFor,
  runningScriptNamedIn,
  scriptStillRunningMessage,
} from "../running-page-script";
import {
  askForAnswerArgs,
  awaitRunningScript,
  SCRIPT_WAIT_LIMIT_MS,
} from "./agent-browser-running-script";

const ID = "k3s9x0ab";

/** What the CLI prints when the browser fails a script as still running. */
const stillRunning = (seconds: number) => ({
  exitCode: 1,
  stderr: `✗ CDP error (Runtime.evaluate): ${scriptStillRunningMessage({ id: ID, seconds })}\n`,
  stdout: "",
});

describe("what the browser and the command say about a running script", () => {
  it("names the script in the message and asks for it by that name", () => {
    const message = scriptStillRunningMessage({ id: ID, seconds: 20 });

    expect(message).toMatchInlineSnapshot(
      `"The script was still running after 20s. The page is responsive, so the script is waiting on something that has not finished (a request, a timer, a promise). It keeps running in the page until it finishes or the page navigates, but its return value is not kept. For work this long, have the script save its results on \`window\` as it goes and read them with a later \`eval\`. [running script: k3s9x0ab]"`,
    );
    expect(runningScriptNamedIn(`✗ CDP error: ${message}\n`)).toBe(ID);
    expect(runningScriptAskedFor(runningScriptAnswerExpression(ID))).toBe(ID);
  });

  // agent-browser replaces an error that mentions a timeout with its own
  // line, and checks the tab for a wedge after "CDP command timed out".
  it("passes through agent-browser as written", () => {
    const message = scriptStillRunningMessage({
      id: ID,
      seconds: 20,
    }).toLowerCase();

    expect(message).not.toContain("timeout");
    expect(message).not.toContain("cdp command timed out");
    expect(message).not.toContain("intercept");
  });

  it.each([["1"], ["document.title"], [undefined], ["scan('k3s9x0ab')"]])(
    "takes %j for a script of its own",
    (expression) => {
      expect(runningScriptAskedFor(expression)).toBeUndefined();
    },
  );

  it("finds no script named by an id alone", () => {
    expect(
      runningScriptNamedIn(
        "✗ Evaluation error: Error: order page said [running script: k3s9x0ab]\n",
      ),
    ).toBeUndefined();
  });

  it("finds no script named in other output", () => {
    expect(
      runningScriptNamedIn(
        "✗ CDP error (Runtime.evaluate): CDP command timed out: Runtime.evaluate\n",
      ),
    ).toBeUndefined();
  });
});

describe("askForAnswerArgs", () => {
  it.each([
    [["eval", "scan()"], ["eval"]],
    [["eval", "--stdin"], ["eval"]],
    [["eval", "-b", "c2Nhbigp"], ["eval"]],
    [
      ["--json", "eval", "scan()", "--quiet"],
      ["--json", "eval", "--quiet"],
    ],
  ])("replaces the script of %j", (args, kept) => {
    expect(askForAnswerArgs(args, ID)).toStrictEqual([
      ...kept,
      runningScriptAnswerExpression(ID),
    ]);
  });
});

describe("awaitRunningScript", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a result that names no running script as it came", async () => {
    const ask = vi.fn();
    const first = {
      exitCode: 1,
      stderr: "✗ Evaluation error: x\n",
      stdout: "",
    };

    expect(await awaitRunningScript({ ask, first, signal: undefined })).toBe(
      first,
    );
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks until the script answers", async () => {
    const answer = { exitCode: 0, stderr: "", stdout: "42\n" };
    const ask = vi
      .fn()
      .mockResolvedValueOnce(stillRunning(40))
      .mockResolvedValueOnce(answer);

    expect(
      await awaitRunningScript({
        ask,
        first: stillRunning(20),
        signal: undefined,
      }),
    ).toBe(answer);
    expect(ask.mock.calls).toStrictEqual([[ID], [ID]]);
  });

  it("returns the script's own failure", async () => {
    const failure = {
      exitCode: 1,
      stderr: "✗ Evaluation error: TypeError: Failed to fetch\n",
      stdout: "",
    };
    const ask = vi.fn().mockResolvedValue(failure);

    expect(
      await awaitRunningScript({
        ask,
        first: stillRunning(20),
        signal: undefined,
      }),
    ).toBe(failure);
  });

  it("reads the script named in --json output", async () => {
    const answer = { exitCode: 0, stderr: "", stdout: "{}\n" };
    const ask = vi.fn().mockResolvedValue(answer);
    const first = {
      exitCode: 1,
      stderr: "",
      stdout: `${JSON.stringify({ error: scriptStillRunningMessage({ id: ID, seconds: 20 }), success: false })}\n`,
    };

    expect(await awaitRunningScript({ ask, first, signal: undefined })).toBe(
      answer,
    );
  });

  it("stops asking once the call is canceled", async () => {
    const canceled = new AbortController();
    const ask = vi.fn(() => {
      canceled.abort();
      return Promise.resolve(stillRunning(40));
    });

    const result = await awaitRunningScript({
      ask,
      first: stillRunning(20),
      signal: canceled.signal,
    });

    expect(ask).toHaveBeenCalledTimes(1);
    expect(result.stderr).toContain("still running after 40s");
  });

  it("stops asking at the limit, saying the script is still running", async () => {
    vi.useFakeTimers();
    let waited = 0;
    const ask = vi.fn(() => {
      waited += 20_000;
      vi.advanceTimersByTime(20_000);
      return Promise.resolve(stillRunning(20 + waited / 1000));
    });

    const result = await awaitRunningScript({
      ask,
      first: stillRunning(20),
      signal: undefined,
    });

    expect(ask).toHaveBeenCalledTimes(SCRIPT_WAIT_LIMIT_MS / 20_000);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("still running after 620s");
  });
});
