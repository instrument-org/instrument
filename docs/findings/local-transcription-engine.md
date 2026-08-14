# Local transcription: engine choice

A user attached a multi-gigabyte podcast MP4, asked for a transcript, and stopped the task after an hour with nothing produced (FP-1245). This records what was measured about the engine underneath that path, and whether the JavaScript implementation it replaced was better.

Nothing here has been acted on. The engine comparison is deliberately left unresolved, because the measurement that would settle it has not been run.

## How much to trust these numbers

Every measurement below comes from one Apple Silicon laptop, under variable load from unrelated Electron apps, on synthetic text-to-speech rather than real podcast audio. Synthetic speech is out of distribution for all of these models, so the word error rates are only comparable to each other and are not the rates these engines get on real recordings.

Read the large ratios as signal and ignore the small differences. Where a conclusion survives the caveat, it is because it rests on documented architecture rather than on a stopwatch, and that is called out.

## What is solid

**CTranslate2 has no Apple GPU backend.** It supports x86-64 and ARM64 CPUs and NVIDIA GPUs with compute capability 3.5 or greater. There is no Metal or MPS path. faster-whisper is built on CTranslate2, so on macOS our local transcription is CPU-only by construction, not by configuration. No flag fixes it. This is the single most important fact here and it comes from the vendor's hardware support documentation, not from a benchmark.

**The skill also gives up the GPU it could use.** `speech-to-text.py` hardcodes `device="cpu"`, so on a Windows or Linux machine with an NVIDIA card, the one platform where CTranslate2 does accelerate, we would still run on the CPU.

**Audio that makes Whisper loop costs far more than audio that does not.** Same machine, same model, same 5 minutes of audio: continuous varied speech ran at 5.6x realtime, and deliberately repetitive speech ran at 1.9x. That roughly 3x swing is the mechanism behind a run that will not finish. It is closer to the real cause than file length is, because a podcast has music, cross-talk, laughter, and silence, which is exactly the material that triggers the repetition behavior.

**Converting the video to audio first is not a performance fix.** faster-whisper decodes through PyAV, which demuxes only the audio stream and never touches the video. Decoding 10 minutes of audio out of an 860 MB 1080p MP4 took 1.06s against 0.07s for the same audio pre-extracted to WAV. Worth doing for clarity and for a smaller intermediate file, but it is not where the hour went.

## Engine comparison, unresolved

On 6 minutes of varied synthetic speech, scored against the text that was spoken:

| Engine and model | Wall clock | Word error rate |
| --- | --- | --- |
| faster-whisper `turbo` | 5.6x realtime | 10.7% |
| faster-whisper `base` | 24.7x realtime | 13.0% |
| whisper.cpp `large-v3-turbo` | 27.6x realtime | 56.2% |
| whisper.cpp `base` | 83x realtime | 34.0% |
| transformers.js `whisper-tiny.en` | 31.9x realtime | 35.5% |
| transformers.js `whisper-base` | 18.7x realtime | 56.0% |

whisper.cpp was several times faster and produced far worse transcripts, dropping roughly 40% of the spoken content. It reached the end of the file rather than truncating, so it was skipping material throughout. Pinning the language and switching to beam search changed the result by nothing at all: byte-identical output, same 56.2%.

That is either a wrong invocation or genuinely bad behavior on synthetic speech, and the two cannot be told apart from here. **Do not act on the speed column.** An engine that is 5x faster and drops 40% of the words is not faster at the job. The architectural argument for looking at whisper.cpp is still good, since it uses Metal on Apple Silicon and CUDA or Vulkan elsewhere, and it is the backend behind FFmpeg 8.0's `whisper` filter. But the case is not made until someone reruns this on a real recording with a known transcript.

Our bundled FFmpeg is 7.1 and has no `whisper` filter. The filter requires FFmpeg 8.0 built with `--enable-whisper` against whisper.cpp, which the static build package we consume does not provide. whisper.cpp's own releases ship prebuilt binaries for Windows and Linux but only an xcframework for Apple platforms, so bundling it on macOS would mean building it ourselves.

## Was the JavaScript implementation better

Partly, and not for the reason you would guess.

The skill that preceded the Python one ran `@huggingface/transformers` on ONNX Runtime and defaulted to `onnx-community/whisper-tiny.en`. Measured above, it is faster in wall clock and substantially worse in accuracy, and most of its speed came from defaulting to a tiny model rather than from the runtime. So no, it was not more performant at equal quality, and switching back on those grounds would be a mistake.

What it did have was a better workflow contract. It accepted `.wav` only, and said so in the skill, with the conversion command spelled out: extract to mono 16 kHz with FFmpeg first. That instruction did not survive the migration to Python. The current Python script accepts any container, which sounds like an improvement and in practice removed the one line that made the agent think about the input at all. The format guidance FP-1245 asks for is not new work. It is a restoration.

## A hosted path

Worth knowing from here: a hosted transcription endpoint is cheap enough that price is not the deciding factor, its per-request cost is computable from the audio duration we already measure, and no vendor reviewed offers zero data retention on terms as strong as what users are told about the local path today. The provider evaluation, the model choice, and the billing design are planned in the backend repo alongside the endpoint itself, since none of it is app-side.

The constraint that matters on this side: the local path stays the default and stays available. The user who reported this asked in the same thread what leaves their machine, and a hosted route that engages silently answers that question wrongly on their behalf.

## Telling the agent what the machine can do

The agent picks a model size today with no information about the computer it is running on. On a machine with no usable accelerator, that is how it chooses something that cannot finish. Giving it the hardware would let it choose against a real constraint instead of a guess, and it composes well with a duration-to-wall-clock table in the skill: the agent multiplies rather than guesses, and can tell the user the cost before starting.

The constraint to respect is the prompt cache. This has to sit in the stable region of the system prompt, be byte-identical every turn, and be derived only from things that do not move. Core count, total RAM, CPU architecture, platform, and whether an accelerator is present all qualify, because none of them change within a session. Free disk, current load, battery state, and thermal state do not: they would rewrite the prefix on every turn and invalidate the cache for the whole conversation. The session context is already rebuilt on a staleness threshold rather than per turn, so a hardware block belongs with the values derived from current state at rebuild time, not with the per-turn parts.

The honest framing is that this makes the agent's choice legible rather than making it correct. It is worth doing because it attacks the actual gap, which is that the agent is choosing blind.

## Where this landed

**The skill guidance shipped.** The input contract, the duration-to-wall-clock table, the calibrate-on-a-sample step, and cross-references between `local-ml`, `ffmpeg`, and `media-download` are in. The table deliberately gives ranges rather than numbers from one machine, and tells the agent to time a 60-second sample and extrapolate, which is the part that works on hardware nobody here has measured.

**The engine stays as it is, and the comparison was not pursued.** Swapping engines was not worth the measurement it would have taken, given that the local path is CPU-bound on most machines whichever engine runs it. The whisper.cpp accuracy result above is therefore unexplained and stays that way on purpose. If anyone revisits it, start by establishing whether the invocation was wrong before reading anything into the speed column.

**A hosted path is the actual fix, and is planned in the backend repo.** No amount of local guidance helps a machine that cannot do the work in reasonable time, and lower-end hardware is exactly where this fails.

## Open questions

- **Whether faster-whisper should use CUDA when present.** A one-line change to a hardcoded device, and the only case where our current engine has an accelerator available. Untouched because it helps only Windows and Linux machines with NVIDIA cards, which is not where the reports come from.
- **What the app has to show when a hosted path exists.** Where the local-versus-remote choice surfaces, and who makes it. That is app-side and unanswered.
