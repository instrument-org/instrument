# Sandbox bake-off probe

Runs real native workloads and known escapes under one sandbox candidate, the way the agent spawns a native command, and prints a table of job, result, seconds, and the first error line. Node 24 or later, no dependencies.

```sh
node scripts/sandbox-bakeoff/probe.ts --runner seatbelt --home /var/tmp/bakeoff/home --granted /var/tmp/bakeoff/home/work --json seatbelt.json
```

- `--home` is a fixture home folder. The probe plants it (a secret at `.ssh/id_test`, a `.zshrc`, the usual cache folders) and runs every job with `HOME` set to it, so no job touches the real home. It must sit outside `/tmp` and the OS temp folder, which every candidate leaves writable.
- `--granted` is the folder the policy grants read and write. Each job runs in its own subfolder, cleared first.
- `--runner` picks the candidate: `none` (control), `seatbelt` (the profile `native-sandbox.ts` generates), `bwrap` (its bubblewrap arguments), `srt` (Anthropic sandbox-runtime; `--srt <bin>` if it is not on `PATH`), `mxc` (`--mxc-sdk <path to @microsoft/mxc-sdk>`), or a path to a module exporting `exec(script, cwd, env, policy)` that resolves to `{ code, output, stdout }`.
- `--only a,b` runs a subset; `--registry <dir>` points at the skills registry (defaults to this repo's `registry/`); `--timeout <seconds>` caps each job (default 900).

Every candidate approximates one policy: the granted folder is read and write, the home folder is readable except the passwords place, and nothing in the home folder is writable except tool caches and stores.

Workloads must pass: sharp, Vite and esbuild, better-sqlite3, uv with numpy, pandas, Pillow and matplotlib, an ffmpeg transcode, a git clone over https with a commit, and the packages registry skills declare (distinct, capped at 15). The `tool-isolation` job plants a person's own setup hostile to ours (a `~/.config/pnpm/rc` with a registry that does not answer, `uv.toml` in the home and in a parent folder, `pip.conf`, `NODE_OPTIONS`, `NODE_PATH`, `PYTHONPATH`, `PYTHONSTARTUP`, `PNPM_HOME`, look-alike `pnpm`, `node`, `uv` and `python` ahead on the `PATH`), runs `pnpm add`, `node`, `uv venv` and `uv pip install` the way the app spawns them, and passes only if none of that setup was honored and nothing new landed in the person's `~/.npm`, `~/.cache`, pnpm or uv caches, or `~/.local/bin`; the app's own tools keep everything in an app-data folder beside the fixture home. Escapes must be blocked: reading `~/.ssh/id_test`, appending to `~/.zshrc`, writing a LaunchAgent on macOS or an autostart entry on Linux, reading through a symlink to `.ssh`, creating a hard link to the secret, reading a hard link made before the sandbox, and on macOS having Finder copy the secret into the granted folder. An escape is judged from outside the sandbox, by what was read or written.

The last line reports the median wall time of a wrapped `true` against an unwrapped one, which is the per-spawn overhead.
