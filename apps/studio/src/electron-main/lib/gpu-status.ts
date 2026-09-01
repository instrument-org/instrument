import { z } from "zod";

import { createScopedLogger } from "./electron-logger";

const log = createScopedLogger("GpuStatus");

interface GpuDevice {
  /** The one Chromium is drawing with, where it named one. */
  active: boolean;
  deviceId: null | number;
  vendor: string;
}

/**
 * Whether Chromium is drawing on the GPU, and on which one.
 *
 * A user reporting that the app ignores their graphics card is reporting
 * something the app has never been able to answer: nothing here sets a GPU
 * switch, so the choice is Chromium's, and Chromium keeps it to itself. The
 * two calls behind this module are the only account of it, and the log line
 * they produce is the only place it reaches.
 *
 * It matters most on a machine with more than one GPU, where the question is
 * not whether drawing is accelerated but which card is doing it. A laptop with
 * an integrated and a discrete GPU can be fully accelerated on the wrong one
 * and look, from inside the app, exactly like a machine that only has the slow
 * one.
 */
export interface GpuStatus {
  /** False when Chromium fell back to drawing in software. */
  accelerated: boolean;
  /** Every GPU Chromium enumerated, in the order it reported them. */
  devices: GpuDevice[];
  /** The statuses {@link GpuStatus.accelerated} is read from. */
  features: Record<string, string>;
  /**
   * The driver's own name for what it is drawing with. The one field that
   * names a card in terms its owner would recognize, and the one that says
   * `llvmpipe` when nothing is accelerated at all.
   */
  renderer: null | string;
}

/**
 * Chromium prefixes every accelerated outcome with `enabled` and every fallback
 * with `disabled` or `unavailable`, so the prefix is the whole test.
 */
const ACCELERATED = "enabled";

/**
 * The two features that decide whether anything reaches the screen by way of
 * the GPU. The rest of what `getGPUFeatureStatus` reports is about particular
 * workloads, which a machine can lack while still compositing on the GPU.
 */
const DECIDING_FEATURES = ["gpu_compositing", "rasterization"];

/**
 * PCI vendor IDs, so a line names a card rather than a number. These cover the
 * machines the app runs on plus the virtual GPU a VM presents, which is worth
 * naming because it is the tell that a result came from a VM and says nothing
 * about real hardware.
 */
const VENDORS = new Map([
  [0x10_02, "AMD"],
  [0x10_6b, "Apple"],
  [0x10_de, "NVIDIA"],
  [0x1a_f4, "virtio"],
  [0x80_86, "Intel"],
]);

/**
 * What `getGPUInfo("complete")` returns, which Electron types as `unknown`
 * because it is Chromium's own dictionary and varies by platform and driver.
 * Parsed rather than asserted, and loosely: every field here is absent on some
 * machine, and a missing one costs a detail rather than the answer.
 */
const GpuInfoSchema = z.looseObject({
  auxAttributes: z
    .looseObject({ glRenderer: z.string().optional() })
    .optional(),
  gpuDevice: z
    .array(
      z.looseObject({
        active: z.boolean().optional(),
        deviceId: z.number().optional(),
        vendorId: z.number().optional(),
      }),
    )
    .optional(),
});

/**
 * One line, because this is read in a log file beside everything else a boot
 * did. Names the active card and the renderer string, since between them they
 * answer both halves of "is it using my GPU".
 */
export function describeGpuStatus(status: GpuStatus): string {
  const active = status.devices.find((device) => device.active);
  const drawing = active ? describeDevice(active) : "no active device";
  const features = DECIDING_FEATURES.map(
    (feature) => `${feature}=${status.features[feature] ?? "unknown"}`,
  ).join(" ");
  return [
    status.accelerated ? "accelerated" : "software only",
    drawing,
    status.renderer === null ? null : `renderer="${status.renderer}"`,
    features,
  ]
    .filter((part) => part !== null)
    .join(" ");
}

/**
 * Write the status into the main log, where an exported log can carry it.
 *
 * Best-effort, and never awaited by anything on the boot path: it costs a line
 * in the one file a user can send back, and nothing in the app reads it.
 */
export async function logGpuStatus(app: Electron.App): Promise<void> {
  try {
    log.info(describeGpuStatus(await readGpuStatus(app)));
  } catch (error) {
    log.warn(new Error("Could not read the GPU status", { cause: error }));
  }
}

/**
 * Ask Electron, and answer with what it said.
 *
 * Only ever called after the app is ready, because `getGPUInfo` resolves off
 * the GPU process and there is none before that. The `complete` dictionary is
 * the one that waits for the GPU process to finish reporting, so the answer is
 * the steady state rather than whatever initialization had reached.
 */
async function readGpuStatus(app: Electron.App): Promise<GpuStatus> {
  // There is not always a GPU process to answer, and `getGPUInfo` rejects when
  // there is none. Drawing in software is the case that puts the app in that
  // state, and it is also the case someone most wants an answer for, so a
  // rejection costs the device list rather than the whole report: the feature
  // status below is synchronous, needs no GPU process, and is the half that
  // says drawing is in software.
  const info = await app.getGPUInfo("complete").catch(() => {});
  // Electron types the feature status as a struct of the keys it knew about
  // when the typings were written, and this reads it as the open map Chromium
  // actually sends, so a feature added upstream still reaches the log.
  const features = Object.fromEntries(
    Object.entries(app.getGPUFeatureStatus()),
  );
  return summarizeGpuStatus(features, info);
}

/**
 * Fold Chromium's two reports into the shape above.
 *
 * Separate from the call so it can be exercised against the dictionaries real
 * machines produce, which is the half worth testing: the call itself has no
 * behavior, and the machine running the test only ever has one answer.
 */
export function summarizeGpuStatus(
  featureStatus: Readonly<Record<string, string>>,
  gpuInfo: unknown,
): GpuStatus {
  const parsed = GpuInfoSchema.safeParse(gpuInfo);
  const info = parsed.success ? parsed.data : undefined;
  const features = { ...featureStatus };

  // Unknown counts as not accelerated. A feature Chromium did not report is one
  // whose state nobody here knows, and claiming acceleration on a machine that
  // has none is the answer that sends a support conversation the wrong way.
  const accelerated = DECIDING_FEATURES.every((feature) =>
    features[feature]?.startsWith(ACCELERATED),
  );

  const devices = (info?.gpuDevice ?? []).map((device) => ({
    active: device.active === true,
    // Zero is Chromium's way of having no PCI device ID to report, which is
    // every Apple Silicon machine, so it means the same thing as an absent one
    // and printing it adds a `0x0` that reads as a real device.
    deviceId: device.deviceId || null,
    vendor: describeVendor(device.vendorId),
  }));

  return {
    accelerated,
    devices,
    features,
    renderer: info?.auxAttributes?.glRenderer ?? null,
  };
}

function describeDevice(device: GpuDevice): string {
  if (device.deviceId === null) {
    return device.vendor;
  }
  return `${device.vendor} 0x${device.deviceId.toString(16)}`;
}

function describeVendor(vendorId: number | undefined): string {
  if (vendorId === undefined) {
    return "unknown";
  }
  return VENDORS.get(vendorId) ?? `0x${vendorId.toString(16)}`;
}
