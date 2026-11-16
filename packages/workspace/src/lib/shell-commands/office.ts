import { type CommandContext, defineCommand } from "just-bash";
import fs from "node:fs/promises";
import nodePath from "node:path";

import {
  OFFICE_COMMAND,
  OFFICE_USAGE,
  officeUnavailable,
  PAGES_NOTE,
  SOFFICE_COMMAND,
  unsupportedFunctionsNote,
} from "../../model-text/commands/office-command";
import { type ChatId } from "../../schemas/chat-id";
import { filterShellOutput } from "../filter-shell-output";
import { ensureOffice, type OfficeInstall } from "../office/install";
import { writeBack } from "../office/recalc";
import { linkSoffice, runSoffice } from "../office/run";
import { usedRanges } from "../office/workbook";
import { ZipPackage } from "../office/zip";
import { askForPythonBaseRefresh, pythonBaseDir } from "../python-base";
import { managedPythonInterpreter } from "../run-uv";
import { getWorkspaceConfig } from "../workspace-config";
import { hostPathOf } from "../workspace-fs-layout";
import { execShim } from "./exec-shim";
import { currentShellOutputSink } from "./output-sink";
import { hostPathArgs, resolveCommandContext } from "./utils";

const RENDERS = new Set([
  ".doc",
  ".docx",
  ".odp",
  ".ods",
  ".odt",
  ".ppt",
  ".pptx",
  ".rtf",
  ".xls",
  ".xlsx",
]);

/** What `--to` takes, by extension. */
const CONVERTS_TO = new Set([
  "csv",
  "doc",
  "docx",
  "html",
  "odp",
  "ods",
  "odt",
  "pdf",
  "ppt",
  "pptx",
  "rtf",
  "txt",
  "xls",
  "xlsx",
]);

/** The most pages `render` draws, so a long document stays readable. */
const MAX_PAGES = 30;

/**
 * Every sheet as its own file of computed values (the CSV filter's last
 * option, `-1`), comma-separated, double-quoted, UTF-8, as shown.
 * https://help.libreoffice.org/latest/en-US/text/shared/guide/csv_params.html
 */
const CSV_EVERY_SHEET =
  "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1";

/** pypdfium2 draws the pages: the PDF engine the app's viewers use. */
const PAGES_SCRIPT = `
import os, sys
import pypdfium2 as pdfium
pdf_path, out_dir, first, last = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
pdf = pdfium.PdfDocument(pdf_path)
count = len(pdf)
os.makedirs(out_dir, exist_ok=True)
for name in os.listdir(out_dir):
    if name.startswith("page-") and name.endswith(".png"):
        os.remove(os.path.join(out_dir, name))
last = min(last, count)
for index in range(first - 1, last):
    page = pdf[index]
    width, height = page.get_size()
    scale = min(2.0, 1600 / max(width, height))
    page.render(scale=scale).to_pil().save(os.path.join(out_dir, f"page-{index + 1}.png"))
print(count)
`;

/**
 * What a call prints: its report, what went wrong, and whether it failed
 * with nothing more to say (a recalc that found errors).
 */
/**
 * What the Mac build logs on every headless start under Seatbelt, which
 * says nothing about the call.
 */
function withoutStartNoise(text: string) {
  return text
    .split("\n")
    .filter(
      (line) =>
        !line.includes("Task policy set failed") &&
        !line.startsWith("sandbox_extension_issue_file_to_process failed"),
    )
    .join("\n");
}

type Output = { failed?: boolean; lines: string[]; problems: string[] };

class UsageError extends Error {}

/** `--name value` and positionals, for a subcommand's arguments. */
function parseArgs(
  args: string[],
  valued: readonly string[],
  flags: readonly string[],
) {
  const options = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const [name, inline] = arg.startsWith("--")
      ? arg.split(/=(.*)/s, 2)
      : [arg];
    if (name !== undefined && valued.includes(name)) {
      const value = inline ?? args[++i];
      if (value === undefined) {
        throw new UsageError(`${name} needs a value`);
      }
      options.set(name, value);
    } else if (name !== undefined && flags.includes(name)) {
      options.set(name, "");
    } else if (arg.startsWith("--")) {
      throw new UsageError(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { options, positional };
}

/** `n`, `n-m` or `none` → the first and last page to draw, or none. */
export function pageRange(spec: string | undefined): [number, number] | null {
  if (spec === undefined || spec === "all") {
    return [1, MAX_PAGES];
  }
  if (spec === "none" || spec === "0") {
    return null;
  }
  const found = /^(\d+)(?:-(\d+))?$/.exec(spec);
  const first = Number(found?.[1]);
  const last = found?.[2] === undefined ? first : Number(found[2]);
  if (!found || first < 1 || last < first) {
    throw new UsageError(`--pages takes n, n-m or none, not ${spec}`);
  }
  return [first, Math.min(last, first + MAX_PAGES - 1)];
}

export function createOfficeCommand(chatId: ChatId) {
  return defineCommand(OFFICE_COMMAND.name, async (args, ctx) => {
    const [sub, ...rest] = args;
    if (
      sub === undefined ||
      sub === "--help" ||
      sub === "-h" ||
      sub === "help"
    ) {
      return {
        exitCode: sub === undefined ? 2 : 0,
        stderr: "",
        stdout: OFFICE_USAGE,
      };
    }
    const out: Output = { lines: [], problems: [] };
    try {
      const run = new OfficeRun(chatId, ctx, out);
      switch (sub) {
        case "render":
          await run.render(rest);
          break;
        case "convert":
          await run.convert(rest);
          break;
        case "recalc":
          await run.recalc(rest);
          break;
        default:
          throw new UsageError(`unknown subcommand ${sub}`);
      }
    } catch (error) {
      if (error instanceof UsageError) {
        return {
          exitCode: 2,
          stderr: `office: ${error.message}\n${OFFICE_USAGE}`,
          stdout: out.lines.length > 0 ? `${out.lines.join("\n")}\n` : "",
        };
      }
      out.problems.push(
        `office: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return {
      exitCode: out.problems.length > 0 || out.failed ? 1 : 0,
      stderr: out.problems.length > 0 ? `${out.problems.join("\n")}\n` : "",
      stdout: out.lines.length > 0 ? `${out.lines.join("\n")}\n` : "",
    };
  });
}

/** One `office` call: its shell's folders, environment and output. */
class OfficeRun {
  private readonly env: Record<string, string>;
  private readonly hostCwd: string;

  constructor(
    chatId: ChatId,
    private readonly ctx: CommandContext,
    private readonly out: Output,
  ) {
    const context = resolveCommandContext(chatId, ctx);
    this.env = { ...getWorkspaceConfig().nodeExecEnv, ...context.env };
    this.hostCwd = context.hostCwd;
  }

  /** The shell's spelling of an operand, resolved from its folder. */
  private shellPathOf(operand: string) {
    return this.ctx.fs.resolvePath(this.ctx.cwd, operand);
  }

  /** How a path is shown: from the shell's folder when it is inside it. */
  private display(shellSpelled: string) {
    const relative = nodePath.posix.relative(this.ctx.cwd, shellSpelled);
    return relative && !relative.startsWith("..") ? relative : shellSpelled;
  }

  private async input(operand: string | undefined, kinds: ReadonlySet<string>) {
    if (operand === undefined) {
      throw new UsageError("name a file");
    }
    const spelled = this.shellPathOf(operand);
    const extension = nodePath.posix.extname(spelled).toLowerCase();
    if (!kinds.has(extension)) {
      throw new UsageError(`${operand}: takes ${[...kinds].sort().join(" ")}`);
    }
    if (!(await this.ctx.fs.exists(spelled))) {
      throw new Error(`${operand}: no such file`);
    }
    return {
      extension,
      host: hostPathOf(spelled),
      spelled,
      stem: nodePath.posix.basename(spelled, nodePath.posix.extname(spelled)),
    };
  }

  private async outFolder(option: string | undefined, fallback: string) {
    const spelled = option === undefined ? fallback : this.shellPathOf(option);
    await this.ctx.fs.mkdir(spelled, { recursive: true });
    return { host: hostPathOf(spelled), spelled };
  }

  /** LibreOffice, installed first when it is not, saying so as it goes. */
  private async office(): Promise<OfficeInstall> {
    const sink = currentShellOutputSink();
    let installedNow: string | undefined;
    const install = await ensureOffice((line) => {
      if (line.startsWith("Installed ")) {
        installedNow = line;
      }
      void sink?.(`${line}\n`);
    });
    if ("reason" in install) {
      throw new Error(
        officeUnavailable(install.reason).replace(/^office: /, ""),
      );
    }
    if (installedNow) {
      this.out.lines.push(installedNow);
    }
    await linkSoffice(install).catch(() => undefined);
    return install;
  }

  private tempRoot() {
    return hostPathOf(this.env.TMPDIR ?? this.ctx.env.get("TMPDIR") ?? "/tmp");
  }

  private async soffice(install: OfficeInstall, args: string[]) {
    const result = await runSoffice(install, args, {
      cwd: this.hostCwd,
      env: this.env,
      signal: this.ctx.signal,
      tempRoot: this.tempRoot(),
    });
    return {
      exitCode: result.exitCode ?? 1,
      output: filterShellOutput(
        withoutStartNoise(`${result.stdout}${result.stderr}`),
      ).trim(),
    };
  }

  /** soffice's own failure, said once with what it printed. */
  private failed(what: string, result: { exitCode: number; output: string }) {
    return new Error(
      `LibreOffice could not ${what} (exit ${result.exitCode})${result.output ? `:\n${result.output}` : ""}`,
    );
  }

  async render(args: string[]) {
    const { options, positional } = parseArgs(args, ["--pages", "--out"], []);
    const pages = pageRange(options.get("--pages"));
    const file = await this.input(positional[0], RENDERS);
    const outDir = await this.outFolder(
      options.get("--out"),
      nodePath.posix.dirname(file.spelled),
    );
    const install = await this.office();
    const result = await this.soffice(install, [
      "--convert-to",
      "pdf",
      "--outdir",
      outDir.host,
      file.host,
    ]);
    const pdfSpelled = nodePath.posix.join(outDir.spelled, `${file.stem}.pdf`);
    if (result.exitCode !== 0 || !(await this.ctx.fs.exists(pdfSpelled))) {
      throw this.failed("render it", result);
    }
    const pagesDir = nodePath.posix.join(outDir.spelled, `${file.stem}-pages`);
    const drawn = pages
      ? await this.drawPages(
          hostPathOf(pdfSpelled),
          hostPathOf(pagesDir),
          pages,
        )
      : undefined;
    const count = drawn && "count" in drawn ? drawn.count : undefined;
    this.out.lines.push(
      `✓ ${this.display(pdfSpelled)}${count === undefined ? "" : `  ${count} ${count === 1 ? "page" : "pages"}`}`,
    );
    if (drawn && "count" in drawn && pages) {
      const last = Math.min(pages[1], drawn.count);
      if (last >= pages[0]) {
        const shown = this.display(pagesDir);
        this.out.lines.push(
          last === pages[0]
            ? `✓ ${shown}/page-${last}.png`
            : `✓ ${shown}/page-${pages[0]}.png … page-${last}.png`,
          ...(drawn.count > last && pages[0] === 1
            ? [
                `  the first ${last} of ${drawn.count} pages; --pages n-m draws others`,
              ]
            : []),
          PAGES_NOTE,
        );
      }
    } else if (drawn && "problem" in drawn) {
      this.out.lines.push(`! no page images: ${drawn.problem}`);
    }
    if (file.extension === ".xlsx") {
      const bytes = await this.ctx.fs.readFileBuffer(file.spelled);
      for (const { name, range } of usedRanges(ZipPackage.read(bytes))) {
        this.out.lines.push(`  sheet ${name}: ${range ?? "empty"}`);
      }
    }
  }

  /** A PNG per page through the managed Python's pypdfium2. */
  private async drawPages(
    pdf: string,
    dir: string,
    [first, last]: [number, number],
  ): Promise<{ count: number } | { problem: string }> {
    const python = await managedPythonInterpreter();
    const base = pythonBaseDir();
    if (!("path" in python) || base === undefined) {
      askForPythonBaseRefresh();
      return {
        problem:
          "Python's PDF packages are still installing; render again in a minute for them",
      };
    }
    const result = await execShim(
      python.path,
      [
        "-I",
        "-c",
        `import sys; sys.path.append(${JSON.stringify(base)})\n${PAGES_SCRIPT}`,
        pdf,
        dir,
        String(first),
        String(last),
      ],
      {
        cancelSignal: this.ctx.signal,
        cwd: this.hostCwd,
        env: this.env,
        stdin: "ignore",
      },
    );
    const count = Number(result.stdout.trim().split("\n").at(-1));
    return result.exitCode === 0 && Number.isInteger(count)
      ? { count }
      : {
          problem:
            filterShellOutput(result.stderr).trim().split("\n").at(-1) ?? "",
        };
  }

  async convert(args: string[]) {
    const { options, positional } = parseArgs(args, ["--to", "--out"], []);
    const to = options.get("--to")?.replace(/^\./, "").toLowerCase();
    if (to === undefined || !CONVERTS_TO.has(to)) {
      throw new UsageError(`--to takes ${[...CONVERTS_TO].sort().join(" ")}`);
    }
    const file = await this.input(
      positional[0],
      new Set([...RENDERS, ".csv", ".html", ".txt"]),
    );
    const outDir = await this.outFolder(options.get("--out"), this.ctx.cwd);
    const before = new Set(await this.ctx.fs.readdir(outDir.spelled));
    const install = await this.office();
    const result = await this.soffice(install, [
      "--convert-to",
      to === "csv" ? CSV_EVERY_SHEET : to,
      "--outdir",
      outDir.host,
      file.host,
    ]);
    const written = (await this.ctx.fs.readdir(outDir.spelled)).filter(
      (name) =>
        name.toLowerCase().endsWith(`.${to}`) &&
        (name === `${file.stem}.${to}` ||
          (to === "csv" &&
            name.startsWith(`${file.stem}-`) &&
            !before.has(name))),
    );
    if (result.exitCode !== 0 || written.length === 0) {
      throw this.failed(`convert it to ${to}`, result);
    }
    for (const name of written.sort()) {
      this.out.lines.push(
        `✓ ${this.display(nodePath.posix.join(outDir.spelled, name))}`,
      );
    }
  }

  async recalc(args: string[]) {
    const { options, positional } = parseArgs(args, [], ["--check"]);
    const check = options.has("--check");
    const file = await this.input(positional[0], new Set([".xlsm", ".xlsx"]));
    const original = await this.ctx.fs.readFileBuffer(file.spelled);
    const install = await this.office();
    const temp = await fs.mkdtemp(
      nodePath.join(this.tempRoot(), "office-recalc-"),
    );
    try {
      const result = await this.soffice(install, [
        "--convert-to",
        "xlsx",
        "--outdir",
        temp,
        file.host,
      ]);
      const exported = await fs
        .readFile(nodePath.join(temp, `${file.stem}.xlsx`))
        .catch(() => undefined);
      if (result.exitCode !== 0 || !exported) {
        throw this.failed("open the workbook", result);
      }
      const outcome = writeBack(original, exported);
      if (!check) {
        await this.ctx.fs.writeFile(file.spelled, outcome.bytes);
      }
      const changed =
        outcome.changed > 0
          ? `, ${outcome.changed} cached ${outcome.changed === 1 ? "value was" : "values were"} stale`
          : "";
      this.out.lines.push(
        `✓ ${this.display(file.spelled)}  ${outcome.formulas} ${outcome.formulas === 1 ? "formula" : "formulas"} recalculated${changed}, ${check ? "nothing written (--check)" : "values written"}`,
      );
      if (outcome.errors.length > 0) {
        this.out.lines.push(
          `✗ ${outcome.errors.length} ${outcome.errors.length === 1 ? "error" : "errors"}`,
        );
        const width = Math.max(
          ...outcome.errors.map(({ cell }) => cell.length),
        );
        const errorWidth = Math.max(
          ...outcome.errors.map(({ error }) => error.length),
        );
        for (const error of outcome.errors.slice(0, 30)) {
          this.out.lines.push(
            `  ${error.cell.padEnd(width)}  ${error.error.padEnd(errorWidth)}  ${error.formula}`,
          );
        }
        if (outcome.errors.length > 30) {
          this.out.lines.push(`  … and ${outcome.errors.length - 30} more`);
        }
      }
      if (outcome.unsupported.cells > 0) {
        this.out.lines.push(
          unsupportedFunctionsNote(
            outcome.unsupported.cells,
            outcome.unsupported.functions,
          ),
        );
      }
      if (outcome.errors.length > 0) {
        this.out.failed = true;
      }
    } finally {
      await fs.rm(temp, { force: true, recursive: true });
    }
  }
}

/**
 * LibreOffice's own command line, installed first when it is not, with a
 * fresh profile per call unless the call names one.
 */
export function createSofficeCommand(chatId: ChatId) {
  return defineCommand(SOFFICE_COMMAND.name, async (args, ctx) => {
    const sink = currentShellOutputSink();
    const install = await ensureOffice((line) => {
      void sink?.(`${line}\n`);
    });
    if ("reason" in install) {
      return {
        exitCode: 1,
        stderr: `${officeUnavailable(install.reason).replace(/^office:/, "soffice:")}\n`,
        stdout: "",
      };
    }
    await linkSoffice(install).catch(() => undefined);
    const { env, hostCwd } = resolveCommandContext(chatId, ctx);
    const result = await runSoffice(install, hostPathArgs(args), {
      cwd: hostCwd,
      env: { ...getWorkspaceConfig().nodeExecEnv, ...env },
      signal: ctx.signal,
      tempRoot: hostPathOf(env.TMPDIR ?? "/tmp"),
    });
    return {
      exitCode: result.exitCode ?? 1,
      stderr: filterShellOutput(withoutStartNoise(result.stderr)),
      stdout: filterShellOutput(result.stdout),
    };
  });
}
