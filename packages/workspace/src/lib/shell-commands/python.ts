import { defineCommand, latin1FromBytes } from "just-bash";

import { TASK_FOLDER_NAMES } from "../../constants";
import { MOUNT } from "../../mount-points";
import { type TaskId } from "../../schemas/task-id";
import { filterShellOutput } from "../filter-shell-output";
import { isAtOrUnder } from "../path-containment";
import { taskDir } from "../task-dir-utils";
import { taskVenvPython } from "../uv";
import { execShim, mapStreams, shimOutput } from "./exec-shim";
import {
  bridgeInlineCodePaths,
  resolveCommandContext,
  resolvePathArgs,
  scanScriptFileForVirtualPaths,
  unreachablePathArgError,
} from "./utils";
import { ensureTaskVenv } from "./uv";

/**
 * Two Pythons, told apart by what they can reach.
 *
 * `python` (and `python3`) is CPython compiled to WebAssembly, run by just-bash
 * inside the sandbox: every file call goes through the same virtual filesystem
 * the shell uses, so it reads an attached folder in place and cannot write to
 * a read-only one. It has the standard library and nothing else.
 *
 * `python-native` is the interpreter in the task's virtualenv, a real process
 * that sees only the task directory. It is where `pip install` puts packages,
 * and it is the only one that can run a package or a native binary.
 *
 * The one place `python` runs natively on its own is a loaded skill's script:
 * a skill declares the dependencies its scripts import, and those were
 * installed into the virtualenv when the skill was loaded.
 */
export const PYTHON_COMMAND = {
  description: `Run Python (CPython 3.13, standard library only) inside the sandbox: it reads ${MOUNT.attachedFolders} and ${MOUNT.task} paths directly and honors read-only mounts. It cannot import an installed package, start a process, open https (no ssl; \`import jb_http\` fetches), or open a file over 8 MB; for those, run the script with \`python-native\`. A loaded skill's script under work/skills/ runs natively on its own.`,
  name: "python",
} as const;

export const PYTHON3_COMMAND = {
  description: "Alias for python.",
  name: "python3",
} as const;

export const PYTHON_NATIVE_COMMAND = {
  description: `Run Python as a real process in the per-task virtualenv (.venv), which is where \`pip install\` puts packages. Sees only the task folder: copy an attached file into the task first. Use it when a script needs an installed package, a native binary, or a file over 8 MB; otherwise \`python\` is the one that reads attached folders.`,
  name: "python-native",
} as const;

/** Under the task, where a loaded skill's copy lives: `work/skills/`. */
const SKILL_COPIES_DIR = `${MOUNT.task}/${TASK_FOLDER_NAMES.work}/${TASK_FOLDER_NAMES.skills}`;

export function createPython3Command(taskId: TaskId) {
  return createSandboxedPythonCommand(taskId, PYTHON3_COMMAND.name);
}

export function createPythonCommand(taskId: TaskId) {
  return createSandboxedPythonCommand(taskId, PYTHON_COMMAND.name);
}

export function createPythonNativeCommand(taskId: TaskId) {
  return defineCommand(PYTHON_NATIVE_COMMAND.name, (args, ctx) =>
    runNativePython(taskId, PYTHON_NATIVE_COMMAND.name, args, ctx),
  );
}

/**
 * `sys.stdlib_module_names` of the vendored CPython 3.13, private names
 * dropped, so a failed import can be told apart: a name in here is a module
 * the WebAssembly build left out (sqlite3, ssl, ctypes, lzma, readline,
 * curses, multiprocessing at call time), not a package to install.
 */
const STDLIB_MODULE_NAMES = new Set(
  "abc,antigravity,argparse,array,ast,asyncio,atexit,base64,bdb,binascii,bisect,builtins,bz2,cProfile,calendar,cmath,cmd,code,codecs,codeop,collections,colorsys,compileall,concurrent,configparser,contextlib,contextvars,copy,copyreg,csv,ctypes,curses,dataclasses,datetime,dbm,decimal,difflib,dis,doctest,email,encodings,ensurepip,enum,errno,faulthandler,fcntl,filecmp,fileinput,fnmatch,fractions,ftplib,functools,gc,genericpath,getopt,getpass,gettext,glob,graphlib,grp,gzip,hashlib,heapq,hmac,html,http,idlelib,imaplib,importlib,inspect,io,ipaddress,itertools,json,keyword,linecache,locale,logging,lzma,mailbox,marshal,math,mimetypes,mmap,modulefinder,msvcrt,multiprocessing,netrc,nt,ntpath,nturl2path,numbers,opcode,operator,optparse,os,pathlib,pdb,pickle,pickletools,pkgutil,platform,plistlib,poplib,posix,posixpath,pprint,profile,pstats,pty,pwd,py_compile,pyclbr,pydoc,pydoc_data,pyexpat,queue,quopri,random,re,readline,reprlib,resource,rlcompleter,runpy,sched,secrets,select,selectors,shelve,shlex,shutil,signal,site,smtplib,socket,socketserver,sqlite3,sre_compile,sre_constants,sre_parse,ssl,stat,statistics,string,stringprep,struct,subprocess,symtable,sys,sysconfig,syslog,tabnanny,tarfile,tempfile,termios,textwrap,this,threading,time,timeit,tkinter,token,tokenize,tomllib,trace,traceback,tracemalloc,tty,turtle,turtledemo,types,typing,unicodedata,unittest,urllib,uuid,venv,warnings,wave,weakref,webbrowser,winreg,winsound,wsgiref,xml,xmlrpc,zipapp,zipfile,zipimport,zlib,zoneinfo".split(
    ",",
  ),
);

/**
 * Explain a failure the sandboxed interpreter reports in its own terms, which
 * would otherwise send the agent looking in the wrong place.
 *
 * Each of these is a limit of the WebAssembly build rather than of the script,
 * and each has a way out through `python-native`. The wording is the whole
 * value: an agent that reads `No module named 'numpy'` with nothing beside it
 * will try `pip install numpy` and run the same command again.
 */
export function explainSandboxedPythonFailure(stderr: string): string {
  let text = stderr
    // The interpreter mounts the virtual filesystem at /host and its own
    // shims prefix paths with it, so an error names '/host/mnt/...' for a
    // file the agent wrote as '/mnt/...'.
    .replaceAll(/(['"])\/host\//g, "$1/")
    // Frames inside the interpreter's own path shims, which sit between the
    // agent's line and the OSError it caused and name a file that is not
    // the script.
    .replaceAll(
      /^ {2}File "\/tmp\/_jb_script\.py", line \d+, in _[^\n]*\n(?: {4}[^\n]*\n)*/gm,
      "",
    );

  const notes: string[] = [];

  const missingModule = /ModuleNotFoundError: No module named '([^']+)'/.exec(
    text,
  )?.[1];
  if (missingModule !== undefined) {
    // `import sqlite3` fails on its C half, `_sqlite3`; name the module the
    // agent typed.
    const topLevel = (missingModule.split(".")[0] ?? missingModule).replace(
      /^_/,
      "",
    );
    notes.push(
      STDLIB_MODULE_NAMES.has(topLevel)
        ? `'${topLevel}' is part of the standard library but this WebAssembly build of CPython does not include it. Run the script with \`${PYTHON_NATIVE_COMMAND.name}\` instead${topLevel === "sqlite3" ? `, or query the database with the \`sqlite3\` command` : ""}.`
        : `'${topLevel}' is not in the standard library, which is all this sandboxed python has. Install it with \`pip install ${topLevel}\` and run the script with \`${PYTHON_NATIVE_COMMAND.name}\`, which uses the task's virtualenv but sees only the task folder (copy an attached file into the task first).`,
    );
  }

  if (text.includes("unknown url type: https")) {
    notes.push(
      `this sandboxed python has no ssl module, so urllib and http.client cannot open https. Fetch with \`import jb_http\` (get/post/put/delete, responses carry .status_code, .text, .json()), with curl from the shell, or run the script with \`${PYTHON_NATIVE_COMMAND.name}\`.`,
    );
  }

  if (text.includes("emscripten does not support processes")) {
    notes.push(
      `this sandboxed python cannot start a process (no subprocess, os.system, or os.fork). Run the command from the shell directly, or run the script with \`${PYTHON_NATIVE_COMMAND.name}\`.`,
    );
  }

  const tooLarge = /File too large: '([^']+)'/.exec(text)?.[1];
  if (tooLarge !== undefined) {
    notes.push(
      `this sandboxed python reads a file whole through an 8 MB bridge, so it cannot open ${tooLarge}. Copy the file into the task (cp '${tooLarge}' ${TASK_FOLDER_NAMES.attachments}/) and run the script with \`${PYTHON_NATIVE_COMMAND.name}\`, or read only part of it with a shell command (head, tail, rg, xan) and work on that.`,
    );
  }

  if (/Execution timeout: exceeded \d+ms limit/.test(text)) {
    notes.push(
      `the sandboxed python is capped at that much run time. For longer work, run the script with \`${PYTHON_NATIVE_COMMAND.name}\`, which is a real process and can keep running in the background.`,
    );
  }

  for (const note of notes) {
    text += `${PYTHON_COMMAND.name}: ${note}\n`;
  }
  return text;
}

/**
 * Whether an invocation runs a loaded skill's script: its file sits under the
 * task's `work/skills/` copy, or the command runs from inside that folder.
 *
 * A skill's scripts import the dependencies the skill declared, which
 * `LoadSkill` installed into the task's virtualenv, so they run natively
 * without the agent having to know there are two interpreters. The same path
 * test is what the mount guard reads, since a script that is carved out here
 * has no sandboxed run to be redirected to.
 */
export function isSkillScriptInvocation(
  args: string[],
  ctx: { cwd: string; fs: { resolvePath(cwd: string, path: string): string } },
): boolean {
  if (isAtOrUnder(SKILL_COPIES_DIR, ctx.fs.resolvePath(ctx.cwd, "."))) {
    return true;
  }
  const scriptIndex = pythonScriptArgIndex(args);
  const script = scriptIndex === undefined ? undefined : args[scriptIndex];
  if (script === undefined) {
    return false;
  }
  return isAtOrUnder(SKILL_COPIES_DIR, ctx.fs.resolvePath(ctx.cwd, script));
}

function createSandboxedPythonCommand(taskId: TaskId, name: string) {
  return defineCommand(name, async (args, ctx) => {
    if (args[0] === "-m" && args[1] === "pip") {
      return {
        exitCode: 1,
        stderr: `\`${name} -m pip\` is not available. Use the \`pip\` command instead, e.g. \`pip install <package>\`; what it installs runs under \`${PYTHON_NATIVE_COMMAND.name}\`.\n`,
        stdout: "",
      };
    }

    if (isSkillScriptInvocation(args, ctx)) {
      return runNativePython(taskId, name, args, ctx, { skillScript: true });
    }

    // The bundled interpreter this command shadows. Absent only if the shell
    // was built without `python: true`, which no caller does; the message is
    // for the day someone does.
    if (ctx.origCommand === undefined) {
      return {
        exitCode: 1,
        stderr: `${name}: the sandboxed interpreter is not registered in this shell.\n`,
        stdout: "",
      };
    }

    const result = await ctx.origCommand(args);
    return {
      ...result,
      stderr: explainSandboxedPythonFailure(result.stderr),
    };
  });
}

/**
 * Index of the first arg python runs as a script file, or undefined for module
 * (`-m`), inline (`-c`), or stdin (`-`) invocations, which have no file to scan.
 * Good enough for the common `python [flags] script.py` shape; on a miss it
 * simply skips the scan (fail-open).
 */
function pythonScriptArgIndex(args: string[]): number | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "-c" || arg === "-m" || arg === "-") {
      return undefined;
    }
    if (arg.startsWith("-")) {
      // `-W`/`-X` take the next arg as their value; skip it so it isn't
      // mistaken for the script file.
      if (arg === "-W" || arg === "-X") {
        i++;
      }
      continue;
    }
    return i;
  }
  return undefined;
}

/**
 * Run the interpreter in the task's virtualenv as a real subprocess.
 *
 * Every virtual path has to be bridged to a host path first, and an attached
 * folder has no host path a subprocess may receive, so those fail before
 * anything spawns. What that failure recommends depends on how we got here:
 * an agent that typed `python` on a skill script cannot be sent back to
 * `python`, so it is told to copy the file in; anyone else is told that the
 * sandboxed `python` reads the folder directly.
 */
async function runNativePython(
  taskId: TaskId,
  name: string,
  args: string[],
  ctx: Parameters<Parameters<typeof defineCommand>[1]>[1],
  { skillScript = false }: { skillScript?: boolean } = {},
) {
  // Catch `python -m pip` before hitting the interpreter; the venv has no
  // seeded pip module, so it would fail with "No module named pip". Direct
  // the agent to the `pip` command instead.
  if (args[0] === "-m" && args[1] === "pip") {
    return {
      exitCode: 1,
      stderr: `\`${name} -m pip\` is not available (pip is not seeded in the venv). Use the \`pip\` command instead, e.g. \`pip install <package>\`.\n`,
      stdout: "",
    };
  }

  const sandboxedAlternative = skillScript
    ? undefined
    : `Run it with \`${PYTHON_COMMAND.name}\` instead, which reads attached folders directly, if the script needs no installed package.`;

  const unreachable = unreachablePathArgError(name, args, ctx.cwd, {
    alternative: sandboxedAlternative,
  });
  if (unreachable !== undefined) {
    return { exitCode: 1, stderr: unreachable, stdout: "" };
  }

  const { env, taskCwd } = resolveCommandContext(taskId, ctx);

  const venvError = await ensureTaskVenv({ ctx, taskId });
  if (venvError !== undefined) {
    return { exitCode: 1, stderr: venvError, stdout: "" };
  }

  // Inline program text (`-c` code, or a heredoc program when python reads
  // the script from stdin) resolves paths against the host filesystem, so
  // bridge sandbox-virtual paths the same way argv paths are bridged.
  const bridgedArgs = [...args];
  let stdin = latin1FromBytes(ctx.stdin);
  const codeIndex = bridgedArgs.indexOf("-c") + 1;
  const readsProgramFromStdin =
    bridgedArgs.length === 0 ||
    (bridgedArgs.length === 1 && bridgedArgs[0] === "-");
  if (codeIndex > 0 && codeIndex < bridgedArgs.length) {
    const bridged = bridgeInlineCodePaths(
      bridgedArgs[codeIndex] ?? "",
      taskId,
      taskCwd,
      { alternative: sandboxedAlternative },
    );
    if ("error" in bridged) {
      return { exitCode: 1, stderr: bridged.error, stdout: "" };
    }
    bridgedArgs[codeIndex] = bridged.code;
  } else if (stdin && readsProgramFromStdin) {
    const bridged = bridgeInlineCodePaths(stdin, taskId, taskCwd, {
      alternative: sandboxedAlternative,
    });
    if ("error" in bridged) {
      return { exitCode: 1, stderr: bridged.error, stdout: "" };
    }
    stdin = bridged.code;
  }

  const finalArgs = resolvePathArgs(bridgedArgs, taskId, ctx);

  // Scan the entry script for sandbox-virtual path literals a real interpreter
  // can't resolve, so it fails with copy-first / use-relative-paths guidance
  // instead of a confusing host-filesystem error deep in a traceback.
  const scriptIndex = pythonScriptArgIndex(bridgedArgs);
  if (scriptIndex !== undefined) {
    const scanError = await scanScriptFileForVirtualPaths(
      taskCwd,
      finalArgs[scriptIndex] ?? "",
      { alternative: sandboxedAlternative },
    );
    if (scanError !== undefined) {
      return { exitCode: 1, stderr: scanError, stdout: "" };
    }
  }

  const result = await execShim(taskVenvPython(taskId), finalArgs, {
    cancelSignal: ctx.signal,
    cwd: taskCwd,
    env,
    // Buffer, not the latin1-packed string: execa UTF-8 encodes string
    // input, which would double-encode every non-ASCII byte.
    ...(stdin ? { input: Buffer.from(stdin, "latin1") } : { stdin: "ignore" }),
  });

  return {
    exitCode: result.exitCode ?? 1,
    ...mapStreams(shimOutput(result, name), (text) =>
      filterShellOutput(text, taskDir(taskId)),
    ),
  };
}
