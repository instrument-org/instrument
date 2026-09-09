# A file the user asks for gets copied somewhere writable

Asked to fetch a file the user already has, the orchestrator copies it into whichever folder it can write, and hands back the copy. It happens about one turn in three on the model the app's auto setting serves, and one clause in the placement bullet suppressed it in every trial that carried it.

## What it looks like

From a real session: "For my iCloud downloads folder, can you grab me the recently saved, I believe it's a soul.md file". The conversation found `SOUL.md` in iCloud Drive, then briefed a task to copy it to the Desktop, and reported the Desktop copy as the answer. The user now has two copies of their own file, the second in a folder they did not choose, and edits to the original no longer show up in what they were handed.

The reasoning trace names the cause, and it is not the verb "grab":

> I believe I can search for the file and then safely copy it to the Desktop, since the iCloud is read-only and the Desktop has write access.

The destination came from which mount was writable. The prompt says where a **result** goes (the folder the user pointed at, else the workspace folder) and said nothing about a file the user already owns, so the conversation treated one as a result needing a home and used the only writable mount it had.

## What was measured

Ad-hoc orchestrator case, the user's own wording, a seeded home holding `SOUL.md` under `Library/Mobile Documents/com~apple~CloudDocs/Downloads`, `openai/gpt-5.6-luna` through OpenRouter, which is what the auto setting serves.

| Condition | Trials | Copied the file | Showed it where it sits |
| --- | --- | --- | --- |
| Without the clause | 3 | 1 | 2 |
| With the clause | 4 | 0 | 4 |

The one that copied did it twice over: the brief it wrote for the task said "copy the newest candidate to `/mnt/Instrument/soul.md` so it can be handed back to the user", and when the task reported a case-insensitive match it sent a second message telling it to copy again.

Four Workers AI models (`glm-5.3`, `kimi-k2.6`, `deepseek-v4-pro`, `gpt-oss-120b`) were run first in both conditions and never reproduced it, with or without the clause. That is the shape to expect from the cheap set on a question like this: the failure belongs to a model that is confident enough to act, and reproducing it costs a `--paid` run.

## The clause

In the "Where results go" bullet of the orchestrator prompt, immediately after the default destination it completes:

> A file the user already has is not a result and needs no home: it is shown where it sits, and it moves only where they said to put it.

An earlier version quoted the user's phrasing ("Grab me that file"), which is the wrong level: the verb did not decide the copy, the writable mount did, and a rule keyed to one phrasing misses "get me", "pull that down", and "save that".

## Reproducing it

```bash
EVAL_HOME=$(mktemp -d)
mkdir -p "$EVAL_HOME/Library/Mobile Documents/com~apple~CloudDocs/Downloads"
printf '# soul\n\nnotes to self\n' > "$EVAL_HOME/Library/Mobile Documents/com~apple~CloudDocs/Downloads/SOUL.md"
INSTRUMENT_EVAL_HOME=$EVAL_HOME pnpm eval run --yes --orchestrator --concurrency 1 \
  --paid --model openai/gpt-5.6-luna --repeat 3 \
  --prompt "For my iCloud downloads folder, can you grab me the recently saved, I believe it's a soul.md file"
```

Then read each `session.md` for a `cp` into a mount, or a files fence naming a path that is not the one the file was found at. Seven trials cost about fifteen cents.
