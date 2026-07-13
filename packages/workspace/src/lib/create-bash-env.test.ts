import { describe, expect, it } from "vitest";

import { createBashDescription } from "./create-bash-env";

describe("createBashDescription", () => {
  // cspell:ignore unexpand fgrep zcat
  it("matches snapshot", () => {
    expect(createBashDescription()).toMatchInlineSnapshot(`
      "Execute bash commands in the task directory.

      IMPORTANT: This is a unix-like (POSIX) shell, regardless of the host OS.

      IMPORTANT: Python is available via the specialized
      \`python\`/\`python3\`/\`pip\`/\`uv\`
      commands below (backed by a per-task virtualenv in work/.venv), and
      TypeScript/JavaScript via the specialized \`tsx\` command. If a
      system command is unavailable, don't keep probing for equivalent binaries
      -- a short script can usually do the job, and a missing command does not
      mean the task is impossible.

      IMPORTANT: \`npm\` is NOT available. Use \`pnpm\` for all
      package management.

      IMPORTANT: Not a persistent terminal -- each call starts fresh from the
      task root, so \`cd .\` is always a no-op. Shell state (env vars, exported
      functions, cwd) does NOT carry across calls; to run somewhere else, prefix
      your command (\`cd subdir && ...\`) within a single call.

      IMPORTANT: Backgrounding is NOT supported. Each call must complete within
      \`timeoutMs\`.

      IMPORTANT: Prefer specialized tools over shell equivalents:
        - Use the \`read_file\` tool instead of \`cat\`/\`head\`/\`tail\`.
        - Use the \`edit_file\`/\`write_file\` tools instead
          of \`sed\`/\`awk\`/redirects for editing.
        - For audio, video, or image inspection, prefer
          \`ffprobe -v error -show_format -show_streams -of json <path>\`
          over \`file\`.

      TIP: Before using an unfamiliar command, run \`<command> --help\` to check
      its argument syntax.

      TIP: Heredoc pipes/redirects go on the \`<<EOF\` line, not after \`EOF\`:
      \`cmd <<'EOF' | jq\` (not \`cmd <<'EOF'\` ... \`EOF\` ... \`| jq\`).

      Available commands (this is the complete set of unix builtins; if a
      command is not listed here it is NOT available, so use one of these or a
      specialized command below instead of assuming): alias, awk, base64, basename, bash, cat, chmod, clear, column, comm, cp, cut, date, diff, dirname, du, echo, egrep, env, expand, expr, false, fgrep, file, find, fold, grep, gunzip, gzip, head, help, history, hostname, join, ln, ls, md5sum, mkdir, mv, nl, od, paste, printenv, printf, pwd, readlink, rev, rg, rm, rmdir, sed, seq, sh, sha1sum, sha256sum, sleep, sort, split, stat, strings, tac, tail, tar, tee, time, timeout, touch, tr, tree, true, unalias, unexpand, uniq, wc, whoami, xargs, zcat

      IMPORTANT: Specialized commands below (e.g. ffmpeg,
      ffprobe) are invoked by bare name only -- never by an
      absolute path. \`which\`/\`command -v\`/\`type\` may report a path like
      /usr/bin/ffmpeg, but that path does NOT exist; ignore it.
      These binaries are also on PATH inside tsx/node
      scripts, so a script may shell out to
      \`ffmpeg\`/\`ffprobe\` directly.

      Specialized commands:
        jq - Parse and manipulate JSON
        xan - Fast CSV processing, filtering, aggregation, and visualization
        yq - Parse and manipulate YAML (like jq but for YAML; e.g. \`yq '.key' file.yaml\`)
        agent-browser - Control a built-in Chromium browser to navigate the web, interact with pages, and extract content.
      IMPORTANT: You MUST load the \`agent-browser\` skill before using this command. Do not run any agent-browser commands until the skill is loaded.
      IMPORTANT: Never fabricate specific or deep URLs from memory -- they change and training data is stale. Well-known root domains are fine; for anything more specific, use \`web_search\` first to discover the correct URL before opening the browser.
      Do NOT pass connection, provider, profile, session, restore, or state flags; the browser session is managed automatically.
        computer - Control native desktop apps through an installed Cua Driver. Run \`computer --help\` before first use.
        ffmpeg - Process audio and video files using FFmpeg.
        ffprobe - Probe and inspect audio and video files using FFprobe.
        pnpm - CLI tool for managing JavaScript packages. Global installs (--global / -g) are not supported; packages must be installed locally.
        pnx - Alias for pnpm dlx.
        tsx - Execute a TypeScript or JavaScript file. In -e: relative paths resolve from cwd; avoid absolute paths and use task-root-relative paths.
        tsc - TypeScript compiler for type-checking. Do not pass individual file paths -- this bypasses tsconfig.json and skips the local config.
        uv - Python package and environment manager. Also provides \`python\`, \`python3\`, and \`pip\`, backed by a per-task virtualenv in work/.venv. The very first Python use fetches a managed interpreter (one-time); later uses are fast.
        python - Run Python via the per-task virtualenv (work/.venv). Shares packages installed with \`pip\`. Use the \`pip\` command to install packages: \`python -m pip\` is not available.
        pip - Install Python packages into the per-task virtualenv (work/.venv) via uv. Use like pip, e.g. \`pip install <package>\`."
    `);
  });

  it("includes just-bash built-in tools", () => {
    const description = createBashDescription();
    expect(description).toContain("grep");
    expect(description).toContain("sed");
    expect(description).toContain("awk");
    expect(description).toContain("jq");
    expect(description).toContain("diff");
  });

  it("includes all commands in a single list", () => {
    const description = createBashDescription();
    expect(description).toContain("pnpm");
    expect(description).toContain("grep");
    expect(description).toContain("jq");
  });

  it("does not advertise npx", () => {
    expect(createBashDescription()).not.toContain("npx");
  });

  it("notes Python availability via specialized commands", () => {
    const description = createBashDescription();
    expect(description).toContain("Python is available");
    expect(description).toContain("work/.venv");
  });
});
