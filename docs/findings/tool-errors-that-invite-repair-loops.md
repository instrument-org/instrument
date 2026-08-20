# Tool errors that invite repair loops

**Status:** fixed. The durable part is the guidance in "What to take from it", which applies to every tool error message.

A tool error is not only a report. It is an instruction, and models follow it further than intended. A message that suggests a way forward on a file that has no way forward turns a bounded failure into an unbounded one.

## What happened

The image work added checks that refuse unreadable media before it enters the transcript, which turns a permanently poisoned session into one tool error the agent can act on. Measuring that across four models on a truncated PNG, one model spent **49 bash calls, 44 `read_file` calls, and 4.1M input tokens across 63 messages** on a single question, and had not stopped when the run was killed. A second model was still going at 824K tokens on a different corrupt fixture.

Neither was malfunctioning. `read_file` told them:

> The file may be truncated or incomplete, or it may not be the format its name says it is. Check what it really is with `ffprobe ...`, and convert it before reading.

On a truncated file there is nothing to convert. The pixel data is absent, every conversion fails differently, and each failure looks like new information worth one more attempt. The tool kept implying a way forward, so the model kept looking for it.

## Why the message was wrong

One string served two failures that call for opposite responses:

- **The bytes are damaged.** The header declares a format and a size, and the data ends early. Unrecoverable. The only useful action is to report it and stop.
- **The bytes are unrecognized.** Nothing identifies them as an image, which is as likely to be a name that lies about its contents as a damaged file. Identifying the real format is worth exactly one look.

Merging them meant the advice for the second case was given for the first, where it cannot work.

## What fixed it

Splitting the two, and making each message say what to stop doing as well as what to do:

- `truncated-image` says the data is gone, not to convert, and not to read the file again.
- `undecodable-image` says to identify the format **once**, and to report back rather than re-read if it will not convert.

Both stop short of naming a remedy. An earlier draft ended with "tell the user it needs to be sent again", which assumes the file arrived because a person supplied it. This runs locally: the file may have been downloaded by the agent, written by a script, extracted from an archive, or sitting in an attached folder. Naming the wrong remedy is the same mistake as naming an impossible one, so the message reports the state and says where the file came from, and leaves the remedy to whoever knows the provenance.

Re-measured across the same four models: every one made exactly **one** read of the bad file, down from 44. None invented an answer it could not have seen.

## What to take from it

- **An error that names a remedy is an instruction to attempt it.** Only name one when it can work. When it cannot, say so explicitly -- "do not retry this file" costs one sentence and bounds the failure.
- **Distinguish unrecoverable from unrecognized** wherever a tool refuses input. They look alike at the call site and diverge completely in what the agent should do next.
- **Loops are invisible to unit tests.** Nothing in the test suite could have caught this: the tool returned the correct result with a correct message every single time. It only appears when a real model reads that message and acts on it, which is an argument for running agent-level evals against failure paths and not just happy paths.
- **The cost is asymmetric.** A bounded failure costs one tool call. An unbounded one costs the context window, the credits, and eventually the session -- the exact outcome the refusal existed to prevent, arriving by a different road.

## Where this lives

`packages/workspace/src/tools/read-file.ts` holds both messages, with the reasoning inline. `packages/workspace/evals/cases/unreadable-media.ts` is the eval that surfaced this; its `Stops asking the file that cannot be read` assertion is what a regression would trip.
