import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { knowChat } from "../../test/helpers/mock-chat-config";
import { browserTargetOf } from "../../types";
import { AGENT_BROWSER_PATH } from "../agent-browser";
import { createLocalBashEnv } from "../create-bash-env";
import { chatDir } from "../record-folders";
import { runtimeLayout } from "../runtime-dir";
import {
  BrowserFollowUp,
  withBrowserFollowUp,
} from "../shell-commands/agent-browser-follow-up";
import { CommandRuns, withCommandRuns } from "../shell-commands/command-runs";
import { owePopup } from "../tab-activity";
import { workDir } from "../work-dir";
import { getWorkspaceConfig } from "../workspace-config";
import { AGENT_BROWSER_STUB_MESSAGE } from "./stub";

// The agent-browser CLI is answered here; `node` and everything else the
// shell starts run for real.
vi.mock("execa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("execa")>();
  return { ...actual, execa: vi.fn(actual.execa) };
});

const chatId = ChatIdSchema.parse("browser-script");
const sessionId = StoreId.newSessionId();

interface CliRun {
  /** The command's own words, after the session the wrapper names. */
  args: string[];
  env: Record<string, string | undefined>;
  input: string | undefined;
  session: string | undefined;
}

let runs: CliRun[] = [];
/** How the CLI ends a command the script asked for; the wrapper's own reads of the page are answered apart. */
let answer: (args: string[]) => {
  exitCode: number;
  stderr: string;
  stdout: string;
};
/** How long the CLI takes over each command. */
let cliMs = 0;

const TABS = JSON.stringify({
  data: {
    tabs: [{ active: true, title: "Orders", url: "https://example.com/" }],
  },
  success: true,
});
const NO_MESSAGES = JSON.stringify({
  data: { result: { loadedAt: 0, regions: [], url: "https://example.com/" } },
  success: true,
});

beforeEach(async () => {
  knowChat(chatId);
  await mkdir(chatDir(chatId), { recursive: true });
  await mkdir(workDir(chatId), { recursive: true });
  runs = [];
  cliMs = 0;
  answer = (args) => ({
    exitCode: 0,
    stderr: "",
    stdout: `${args.join(" ")}\n`,
  });
  const { execa } = await import("execa");
  const actual = await vi.importActual<typeof import("execa")>("execa");
  // execa's overloads and its subprocess carry far more than a run of the
  // CLI reads back.
  vi.mocked(execa).mockImplementation(((
    file: string,
    given: string[],
    options: {
      cancelSignal?: AbortSignal;
      env?: Record<string, string | undefined>;
      input?: Buffer;
    },
  ) => {
    if (file !== AGENT_BROWSER_PATH) {
      return actual.execa(file, given, options as never);
    }
    // A stopped command starts nothing, as execa starts nothing for one.
    if (options.cancelSignal?.aborted) {
      return Object.assign(
        Promise.resolve({ exitCode: undefined, stderr: "", stdout: "" }),
        { once: () => undefined },
      );
    }
    const at = given.indexOf("--session");
    const args = at === -1 ? given : given.slice(at + 2);
    runs.push({
      args,
      env: options.env ?? {},
      input: options.input?.toString("utf8"),
      session: at === -1 ? undefined : given[at + 1],
    });
    const ended =
      args[0] === "--json" && args[1] === "eval"
        ? { exitCode: 0, stderr: "", stdout: NO_MESSAGES }
        : args[0] === "tab"
          ? { exitCode: 0, stderr: "", stdout: TABS }
          : args[0] === "snapshot"
            ? { exitCode: 0, stderr: "", stdout: '- link "Next" [ref=e1]\n' }
            : args[0] === "wait"
              ? { exitCode: 0, stderr: "", stdout: "" }
              : answer(args);
    return Object.assign(
      sleep(cliMs).then(() => ended),
      { once: () => undefined },
    );
  }) as never);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

/** The words of the commands the script asked for, leaving out the wrapper's own reads of the page. */
function asked() {
  return runs
    .map((run) => run.args)
    .filter(
      (args) =>
        !(args[0] === "--json" && args[1] === "eval") &&
        !["snapshot", "tab", "wait"].includes(args[0] ?? ""),
    );
}

async function shell() {
  return createLocalBashEnv({ chatId, sessionId });
}

function node(code: string) {
  return `node --input-type=module <<'EOF'\n${code}\nEOF`;
}

describe("instrument.browser in a script", () => {
  it("runs each command as the shell's agent-browser does, as the session, and hands back what it printed", async () => {
    const bash = await shell();
    const result = await bash.exec(
      node(`const opened = await instrument.browser("open", "https://example.com/orders?page=2");
const title = await instrument.browser(["get", "title"]);
const piped = await instrument.browser("eval", "--stdin", { stdin: "document.title" });
console.log(JSON.stringify([opened, title, piped]));`),
    );

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual([
      "open https://example.com/orders?page=2\n",
      "get title\n",
      "eval --stdin\n",
    ]);
    expect(asked()).toEqual([
      ["open", "https://example.com/orders?page=2"],
      ["get", "title"],
      ["eval", "--stdin"],
    ]);
    // The session's own tabs in the app's browser, as a typed command gets.
    expect(runs.every((run) => run.session === sessionId)).toBe(true);
    expect(
      runs.every((run) => run.env.AGENT_BROWSER_PROVIDER === "instrument"),
    ).toBe(true);
    expect(runs.find((run) => run.args[0] === "eval")?.input).toBe(
      "document.title",
    );
  });

  it("resolves a file the command names from the folder the script was started in", async () => {
    const bash = await shell();
    const result = await bash.exec(
      `mkdir -p shots && cd shots && echo png > photo.png && ${node(`await instrument.browser("upload", "@e1", "photo.png");`)}`,
    );

    expect(result.stderr).toBe("");
    expect(asked()).toEqual([
      ["upload", "@e1", path.join(workDir(chatId), "shots", "photo.png")],
    ]);
  });

  it.each([
    [["--session", "mine", "open", "https://example.com"]],
    [["--cdp", "9222", "open", "https://example.com"]],
    [["close"]],
    [["batch"]],
  ])("refuses %j in the words the shell refuses it in", async (words) => {
    const bash = await shell();
    const typed = await bash.exec(`agent-browser ${words.join(" ")}`);
    const result = await bash.exec(
      node(`try {
  await instrument.browser(${JSON.stringify(words)});
} catch (error) {
  console.log(JSON.stringify([error.name, error.exitCode, error.stderr, error.stdout]));
}`),
    );

    expect(typed.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual([
      "InstrumentError",
      1,
      typed.stderr,
      "",
    ]);
    expect(runs).toEqual([]);
  });

  it("rejects with a failed command's exit code and what it printed", async () => {
    answer = () => ({
      exitCode: 1,
      stderr: "✗ Element not found: @e9\n",
      stdout: "",
    });
    const followUp = new BrowserFollowUp();
    const bash = await shell();
    const result = await withBrowserFollowUp(followUp, () =>
      bash.exec(
        node(`try {
  await instrument.browser("click", "@e9");
} catch (error) {
  console.log(JSON.stringify([error.message, error.exitCode, error.stderr]));
}
await instrument.browser("click", "@e9");`),
      ),
    );

    expect(result.stdout).toBe(
      `${JSON.stringify(["✗ Element not found: @e9", 1, "✗ Element not found: @e9\n"])}\n`,
    );
    // Uncaught, the failure ends the script and its output names it.
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("InstrumentError: ✗ Element not found");
    // And the end of the call would name one its output hid.
    expect(followUp.takeFailures("").failed).toEqual([
      { command: "click @e9", error: "Element not found: @e9" },
      { command: "click @e9", error: "Element not found: @e9" },
    ]);
  });

  it.skipIf(process.platform === "win32")(
    "leaves a process the script starts with no way to it",
    async () => {
      // Studio puts the runtime folder's bin first on its own PATH, which
      // every program it starts gets.
      vi.stubEnv(
        "PATH",
        [
          runtimeLayout(getWorkspaceConfig().runtimeDir).bin,
          process.env.PATH,
        ].join(path.delimiter),
      );
      const bash = await shell();
      const result = await bash.exec(
        node(`import { spawnSync } from "node:child_process";
const started = spawnSync("agent-browser", ["eval", "document.title"], { encoding: "utf8" });
console.log(JSON.stringify([started.status, started.stdout, started.stderr]));
const child = spawnSync(process.execPath, ["-e", "console.log(typeof instrument, process.env.INSTRUMENT_CHANNEL)"], { encoding: "utf8" });
console.log(child.stdout.trim());`),
      );

      expect(result.stderr).toBe("");
      const [first, second] = result.stdout.trim().split("\n");
      expect(JSON.parse(first ?? "")).toEqual([
        127,
        "",
        `${AGENT_BROWSER_STUB_MESSAGE}\n`,
      ]);
      expect(second).toBe("undefined undefined");
      expect(runs).toEqual([]);
    },
  );

  it("stops a script in the middle of its loop when the bash call is stopped", async () => {
    cliMs = 20;
    const controller = new AbortController();
    const bash = await shell();
    const running = bash
      .exec(
        node(`for (let page = 1; ; page++) {
  await instrument.browser("open", "https://example.com/orders?page=" + page);
}`),
        { signal: controller.signal },
      )
      .catch((error: unknown) => error);
    await vi.waitFor(() => {
      expect(asked().length).toBeGreaterThanOrEqual(3);
    });

    controller.abort();
    await running;
    const stoppedAt = asked().length;
    await sleep(300);

    expect(asked()).toHaveLength(stoppedAt);
  });

  it("leaves what the command adds for the model to the end of the bash call, once", async () => {
    const from = browserTargetOf(StoreId.newTabId());
    owePopup(sessionId, {
      from,
      tabId: "tab_01M5Q2CY3JB5G7KJVE1QA1HK0B",
      url: "https://example.com/receipt",
    });
    const followUp = new BrowserFollowUp();
    const commandRuns = new CommandRuns();
    const bash = await shell();
    const result = await withCommandRuns(commandRuns, () =>
      withBrowserFollowUp(followUp, () =>
        bash.exec(
          node(`for (const page of [1, 2, 3]) {
  process.stdout.write(await instrument.browser("open", "https://example.com/orders?page=" + page));
}`),
        ),
      ),
    );

    // The script read each command's own output and nothing else.
    expect(result.stdout).toBe(
      [1, 2, 3]
        .map((page) => `open https://example.com/orders?page=${page}\n`)
        .join(""),
    );
    expect(runs.filter((run) => run.args[0] === "snapshot")).toEqual([]);
    expect(followUp.scripted).toBe(true);
    expect(followUp.takeNews()).toEqual([
      `The page in tab ${from} opened https://example.com/receipt as a popup, which is a new tab of this chat, tab_01M5Q2CY3JB5G7KJVE1QA1HK0B: \`agent-browser tab tab_01M5Q2CY3JB5G7KJVE1QA1HK0B\` switches to it.`,
    ]);
    expect(followUp.takeNews()).toEqual([]);

    // The page as the whole call left it, read once.
    const page = await followUp.take(new AbortController().signal);
    expect(page).toMatchObject({ after: "open", kind: "full" });
    expect(runs.filter((run) => run.args[0] === "snapshot")).toHaveLength(1);
    expect(await followUp.take(new AbortController().signal)).toBeUndefined();

    // The session log counts the commands the script ran.
    expect(
      commandRuns.rows().find((row) => row.name === "agent-browser"),
    ).toMatchObject({ count: 3, source: "bundled" });
  });
});
