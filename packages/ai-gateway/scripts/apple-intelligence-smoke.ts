import { generateText, streamText } from "ai";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect, promisify } from "node:util";

const MODEL_ID = "apple-on-device";
const TEXT_PROMPT =
  "Reply with one short sentence confirming this was generated locally.";
const STREAM_PROMPT = "Count from one to five in words, separated by commas.";
const execFileAsync = promisify(execFile);
const requireNative = createRequire(import.meta.url);

function formatError(error: unknown) {
  if (error instanceof Error) {
    return (
      error.stack ?? [error.name, error.message].filter(Boolean).join("\n")
    );
  }

  return inspect(error, { depth: 6 });
}

async function getMacOSVersion() {
  if (process.platform !== "darwin") {
    return null;
  }

  try {
    const { stdout } = await execFileAsync("sw_vers", ["-productVersion"]);
    return stdout.trim();
  } catch {
    return null;
  }
}

function getNativeLoadDiagnostics() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(scriptDir, "..");
  const workspaceRoot = path.resolve(packageRoot, "../..");
  const packagePath = path.join(
    "node_modules",
    "@meridius-labs",
    "apple-on-device-ai",
    "build",
    "apple_ai_napi.node",
  );
  const candidatePaths = [
    path.resolve(packageRoot, packagePath),
    path.resolve(workspaceRoot, packagePath),
  ];

  for (const candidatePath of candidatePaths) {
    if (!existsSync(candidatePath)) {
      continue;
    }

    try {
      requireNative(candidatePath);
      return `[diagnostic] Native binary loads directly from ${candidatePath}`;
    } catch (error) {
      return [
        `[diagnostic] Native binary exists at ${candidatePath}`,
        "Direct dlopen failed:",
        formatError(error),
      ].join("\n");
    }
  }

  return "[diagnostic] Native binary was not found in expected package paths";
}

async function importAppleOnDeviceAI() {
  return import("@meridius-labs/apple-on-device-ai");
}

async function main() {
  writeLine("Apple Intelligence smoke test");
  writeLine(`platform=${process.platform}`);
  writeLine(`arch=${process.arch}`);
  writeLine(`node=${process.version}`);
  const macOSVersion = await getMacOSVersion();
  if (macOSVersion) {
    writeLine(`macos=${macOSVersion}`);
  }
  writeLine(`os=${os.type()} ${os.release()}`);
  writeLine();

  let appleOnDeviceAI: Awaited<ReturnType<typeof importAppleOnDeviceAI>>;

  try {
    appleOnDeviceAI = await importAppleOnDeviceAI();
    writeLine("[ok] loaded @meridius-labs/apple-on-device-ai");
  } catch (error) {
    writeFailure({ error, step: "load native Apple on-device AI package" });
    process.stderr.write(`\n${getNativeLoadDiagnostics()}\n`);
    process.exitCode = 1;
    return;
  }

  const { appleAI, appleAISDK, chat } = appleOnDeviceAI;

  let availability: Awaited<ReturnType<typeof appleAISDK.checkAvailability>>;

  try {
    availability = await appleAISDK.checkAvailability();
    writeLine(`[ok] checkAvailability ${JSON.stringify(availability)}`);
  } catch (error) {
    writeFailure({ error, step: "check Apple Intelligence availability" });
    process.exitCode = 1;
    return;
  }

  if (!availability.available) {
    process.stderr.write(
      `\n[unavailable] Apple Intelligence: ${availability.reason}\n`,
    );
    process.exitCode = 1;
    return;
  }

  try {
    writeLine("\n[native chat]");
    const nativeResult = await chat({
      maxTokens: 80,
      messages: TEXT_PROMPT,
      temperature: 0.1,
    });
    writeLine(nativeResult.text.trim());
  } catch (error) {
    writeFailure({ error, step: "native chat inference" });
    process.exitCode = 1;
    return;
  }

  const model = appleAI(MODEL_ID, { maxTokens: 80, temperature: 0.1 });

  try {
    writeLine("\n[ai sdk generateText]");
    const result = await generateText({
      model,
      prompt: TEXT_PROMPT,
    });
    writeLine(result.text.trim());
  } catch (error) {
    writeFailure({ error, step: "AI SDK generateText inference" });
    process.exitCode = 1;
    return;
  }

  try {
    writeLine("\n[ai sdk streamText]");
    const result = streamText({
      model,
      prompt: STREAM_PROMPT,
    });

    let streamedText = "";

    for await (const delta of result.textStream) {
      streamedText += delta;
      process.stdout.write(delta);
    }

    writeLine();
    writeLine(`[ok] streamed ${streamedText.length.toString()} characters`);
  } catch (error) {
    writeFailure({ error, step: "AI SDK streamText inference" });
    process.exitCode = 1;
    return;
  }

  writeLine("\n[ok] Apple Intelligence smoke test completed");
}

function writeFailure({ error, step }: { error: unknown; step: string }) {
  process.stderr.write(`\n[failed] ${step}\n${formatError(error)}\n`);
}

function writeLine(message = "") {
  process.stdout.write(`${message}\n`);
}

await main();
