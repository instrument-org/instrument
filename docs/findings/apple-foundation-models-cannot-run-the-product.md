# Apple's Foundation Models cannot run the product

**Status:** closed, measured 2026-10-07 on macOS 27.0.1 with the on-device model ("AFM 3 Core Advanced", 8,192-token context). The on-device model cannot drive the agent: it cannot hold the prompt, and given a prompt it can hold, it fails most small multi-step tasks in ways typical of very small models. The Private Cloud Compute model was not measured, because it sits behind an entitlement we do not have. Reopen when a newer model ships or the entitlement is granted, using the method below.

Companion reading: [which Workers AI models can run the product](which-workers-ai-models-can-run-the-product.md), the same question asked of a different catalog.

## The short answer

| | On-device (`SystemLanguageModel`) | Private Cloud Compute (`PrivateCloudComputeLanguageModel`) |
| --- | --- | --- |
| Context | 8,192 tokens (4,096 before macOS 27) | 32,768 tokens |
| Reports | tool calling, vision, guided generation | tool calling, vision, guided generation, reasoning (light, moderate, deep), a usage quota |
| Holds our chat prompt (~12.4k tokens before any history) | no | yes |
| Holds a working task (one measured task reached ~55k) | no | no |
| Measured | yes: 9 of 24 small agent tasks | no: needs `com.apple.developer.private-cloud-compute` |

## Method

A throwaway Swift harness, not the product: the product's prompt does not fit, so running `pnpm eval` against the model would only have measured the overflow. Instead the model got a two-sentence system prompt and four tools with real effects in a scratch folder: list a directory, read a file (cut at 3,000 characters), write a file, and run a zsh command under `sandbox-exec` with writes confined to that folder and the network denied. Tool parameters were JSON Schema. Each task ran three times with a cap of 12 tool calls and a deterministic check of the folder or the answer afterwards. No cloud model ran the same tasks; each is one any frontier model completes reliably.

## What it did

| Task | Passed | How it failed |
| --- | --- | --- |
| Turn grocery items in a note into a checklist file | 3/3 | |
| Write a word-count script, run it, report the count | 3/3 | |
| Count errors in a large log and name the most common | 2/3 | ran a malformed pipeline, then called every error the same message |
| Fix the spelling mistakes in a README | 1/3 | announced "I will correct it" and stopped; rewrote the file without its heading |
| Find which config file sets the API URL | 0/3 | listed `project/`, then read `config/…` without the `project/` prefix and gave up |
| Rename `.jpeg` files to `.jpg` | 0/3 | the same dropped prefix, then blamed file permissions |
| Add a date from an email to `calendar.txt` | 0/3 | found the right date, then overwrote the file and lost its existing line |
| Total one month's revenue from a CSV | 0/3 | invented shell syntax and reported a number it never computed; one run overflowed 8,192 tokens |

Steps took 0.5 to 2 seconds. Calling tools is not the problem. Holding state across steps is: a path learned one call earlier is gone by the next, a file's existing contents are not considered before writing, and a failed command is followed by a confident answer. These are the failure shapes of very small models generally, not something particular to Apple's.

Single-shot work went better, and was not pursued: picking one of five routes for a message (12 of 14), extracting an event to JSON (5 of 6, missing relative-date arithmetic), answering from a document up to about 5,800 tokens (9 of 9), and one-line summaries, each in 0.4 to 1.2 seconds. Given the product's own title prompt, it named substantive messages well but wrote "nothing" or "hi" where the prompt asks for an empty answer.

## What stays true if this is reopened

- **JSON Schema converts directly.** `GenerationSchema` is `Codable`, and decoding a JSON Schema object succeeds once each object carries an `x-order` array naming its properties. Without it, decoding fails on the missing key. Tools can therefore be declared at run time from the schemas the agent already has, without `@Generable`, whose macro needs full Xcode rather than the Command Line Tools.
- **A single step can stop at a tool call**, which is the shape the AI SDK's model interface expects. A tool whose `call` throws hands its name and arguments back to the caller, and the next step builds a new session from a `Transcript` carrying the instructions, prompt, tool calls, and tool outputs. Every type needed for that is public. A provider would wrap this in the Swift helper (`apps/studio/native/mac-helper`, see [the Mac bridge](../architecture/mac-native-bridge.md)).
- **macOS 27 adds** `SystemLanguageModel.contextSize`, `variant` (`core3` and `coreAdvanced3`, so weaker hardware likely gets a weaker model than the one measured here), `tokenCount(for:)`, a `ToolCallingMode` (`allowed`, `required`, `disallowed`), and a `LanguageModel` protocol the cloud model also conforms to.
- **Private Cloud Compute needs an entitlement.** From an unsigned binary every request fails with `ModelManagerError` 1046, plain prompts included. The entitlement name, `com.apple.developer.private-cloud-compute`, appears in the system's shared library cache. The Developer ID provisioning profile in `apps/studio/build` grants only the application identifier, team identifier, and keychain access groups, so measuring it starts with Apple adding the capability to the App ID and a new profile.

## Reference

The reference integration examined was [Handy](https://github.com/cjpais/Handy) (`src-tauri/swift/apple_intelligence.swift`), which uses the on-device model for a single job: one prompt cleans up a dictated transcript, with no tools or history. It compiles a C-callable Swift shim into the Rust binary, weak-links FoundationModels, and builds a stub when the SDK or toolchain lacks it.
