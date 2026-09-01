import { describe, expect, it } from "vitest";

import { describeGpuStatus, summarizeGpuStatus } from "./gpu-status";

/**
 * What Chromium reports when everything is drawn on the GPU. Only the two
 * features the summary reads are varied across these tests; the rest are here
 * because a real dictionary carries them and the summary keeps what it is given.
 */
const ACCELERATED_FEATURES = {
  "2d_canvas": "enabled",
  gpu_compositing: "enabled",
  rasterization: "enabled",
  video_decode: "enabled",
  webgl: "enabled",
};

const SOFTWARE_FEATURES = {
  "2d_canvas": "enabled",
  gpu_compositing: "disabled_software",
  rasterization: "disabled_software",
  video_decode: "unavailable_software",
  webgl: "unavailable_software",
};

/**
 * A dual-GPU laptop drawing on the integrated card while a discrete one sits
 * there unused. The shape behind a user reporting that the app ignores their
 * graphics card: fully accelerated, and on the wrong GPU, which no single
 * accelerated-or-not answer would have caught.
 */
const DUAL_GPU_ON_INTEGRATED = {
  auxAttributes: { glRenderer: "Mesa Intel(R) UHD Graphics 630 (CFL GT2)" },
  gpuDevice: [
    { active: true, deviceId: 0x3e_9b, vendorId: 0x80_86 },
    { active: false, deviceId: 0x73_40, vendorId: 0x10_02 },
  ],
};

describe("summarizeGpuStatus", () => {
  it("reports the active card and the renderer behind it", () => {
    const status = summarizeGpuStatus(
      ACCELERATED_FEATURES,
      DUAL_GPU_ON_INTEGRATED,
    );

    expect(status.accelerated).toBe(true);
    expect(status.devices).toMatchInlineSnapshot(`
      [
        {
          "active": true,
          "deviceId": 16027,
          "vendor": "Intel",
        },
        {
          "active": false,
          "deviceId": 29504,
          "vendor": "AMD",
        },
      ]
    `);
    expect(status.renderer).toBe("Mesa Intel(R) UHD Graphics 630 (CFL GT2)");
  });

  // Both are needed, because a machine can composite on the GPU and rasterize
  // in software, and that is not a machine anyone should be told is accelerated.
  it.each([
    { expected: true, features: ACCELERATED_FEATURES, name: "both enabled" },
    { expected: false, features: SOFTWARE_FEATURES, name: "both software" },
    {
      expected: false,
      features: { ...ACCELERATED_FEATURES, rasterization: "disabled_software" },
      name: "rasterization in software",
    },
    {
      expected: false,
      features: { ...ACCELERATED_FEATURES, gpu_compositing: "disabled_off" },
      name: "compositing off",
    },
  ])("calls $name accelerated=$expected", ({ expected, features }) => {
    expect(
      summarizeGpuStatus(features, DUAL_GPU_ON_INTEGRATED).accelerated,
    ).toBe(expected);
  });

  // A status Chromium did not report is not a status anyone here knows, and
  // guessing it enabled is the guess that misdirects a support conversation.
  it("does not read a missing feature as accelerated", () => {
    expect(summarizeGpuStatus({}, DUAL_GPU_ON_INTEGRATED).accelerated).toBe(
      false,
    );
  });

  // The dictionary is Chromium's and varies by platform and driver, so every
  // field it carries has to be optional here. Losing one costs a detail.
  it.each([
    { gpuInfo: {}, name: "an empty dictionary" },
    { gpuInfo: undefined, name: "nothing at all" },
    { gpuInfo: { gpuDevice: "not an array" }, name: "an unexpected shape" },
  ])("survives $name", ({ gpuInfo }) => {
    const status = summarizeGpuStatus(ACCELERATED_FEATURES, gpuInfo);

    expect(status.devices).toEqual([]);
    expect(status.renderer).toBeNull();
    expect(status.accelerated).toBe(true);
  });

  // What an Apple Silicon machine reports, where there is no PCI device to
  // have an ID. Taken from a real boot, which is where the zero came from.
  it("reads a zero device id as no device id", () => {
    const status = summarizeGpuStatus(ACCELERATED_FEATURES, {
      auxAttributes: {
        glRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max)",
      },
      gpuDevice: [{ active: true, deviceId: 0, vendorId: 0x10_6b }],
    });

    expect(status.devices).toEqual([
      { active: true, deviceId: null, vendor: "Apple" },
    ]);
    expect(describeGpuStatus(status)).toMatchInlineSnapshot(
      `"accelerated Apple renderer="ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max)" gpu_compositing=enabled rasterization=enabled"`,
    );
  });

  it("names an unknown vendor by its id rather than dropping it", () => {
    const status = summarizeGpuStatus(ACCELERATED_FEATURES, {
      gpuDevice: [{ active: true, deviceId: 0x12_34, vendorId: 0xab_cd }],
    });

    expect(status.devices).toEqual([
      { active: true, deviceId: 0x12_34, vendor: "0xabcd" },
    ]);
  });
});

describe("describeGpuStatus", () => {
  it("names the card being drawn on", () => {
    expect(
      describeGpuStatus(
        summarizeGpuStatus(ACCELERATED_FEATURES, DUAL_GPU_ON_INTEGRATED),
      ),
    ).toMatchInlineSnapshot(
      `"accelerated Intel 0x3e9b renderer="Mesa Intel(R) UHD Graphics 630 (CFL GT2)" gpu_compositing=enabled rasterization=enabled"`,
    );
  });

  // The line a machine with no acceleration writes. `llvmpipe` is Mesa's
  // software renderer, and its presence is the answer on its own.
  it("says so when nothing is accelerated", () => {
    const status = summarizeGpuStatus(SOFTWARE_FEATURES, {
      auxAttributes: { glRenderer: "llvmpipe (LLVM 17.0.6, 256 bits)" },
      gpuDevice: [{ active: true, deviceId: 0x10_50, vendorId: 0x1a_f4 }],
    });

    expect(describeGpuStatus(status)).toMatchInlineSnapshot(
      `"software only virtio 0x1050 renderer="llvmpipe (LLVM 17.0.6, 256 bits)" gpu_compositing=disabled_software rasterization=disabled_software"`,
    );
  });

  it("still reads when Chromium named no device", () => {
    expect(
      describeGpuStatus(summarizeGpuStatus(ACCELERATED_FEATURES, {})),
    ).toMatchInlineSnapshot(
      `"accelerated no active device gpu_compositing=enabled rasterization=enabled"`,
    );
  });
});
