import { describe, expect, it } from "vitest";

import {
  microphoneNames,
  pickableInputs,
  resolveMicrophone,
} from "./dictation-microphone";

const devices = [
  { deviceId: "default", label: "Default - MacBook Pro Microphone" },
  { deviceId: "a1", label: "MacBook Pro Microphone" },
  { deviceId: "b2", label: "Studio Display Microphone" },
];

describe("resolveMicrophone", () => {
  it.each([
    ["nothing picked uses the default", undefined, { missing: false }],
    [
      "a device still listed under its id",
      { deviceId: "b2", label: "Studio Display Microphone" },
      { deviceId: "b2", missing: false },
    ],
    [
      "a device whose id changed is found by its label",
      { deviceId: "old-id", label: "Studio Display Microphone" },
      { deviceId: "b2", missing: false },
    ],
    [
      "a device that is gone falls back to the default",
      { deviceId: "c3", label: "USB Microphone" },
      { missing: true },
    ],
    [
      "the default's pseudo-device is never matched by label",
      { deviceId: "x", label: "Default - MacBook Pro Microphone" },
      { missing: true },
    ],
  ])("%s", (_case, chosen, expected) => {
    expect(resolveMicrophone(chosen, devices)).toEqual(expected);
  });

  it("never matches a device by an empty label", () => {
    expect(
      resolveMicrophone({ deviceId: "gone", label: "" }, [
        { deviceId: "a1", label: "" },
      ]),
    ).toEqual({ missing: true });
  });

  it("prefers the exact id among devices that share a label", () => {
    const twins = [
      { deviceId: "left", label: "USB Audio" },
      { deviceId: "right", label: "USB Audio" },
    ];
    expect(
      resolveMicrophone({ deviceId: "right", label: "USB Audio" }, twins),
    ).toEqual({ deviceId: "right", missing: false });
  });
});

describe("microphoneNames", () => {
  it("drops hardware ids and numbers names two devices share", () => {
    expect([
      ...microphoneNames([
        { deviceId: "a", label: "MacBook Pro Microphone (Built-in)" },
        { deviceId: "b", label: "Yeti Stereo Microphone (046d:0ab1)" },
        { deviceId: "c", label: "AirPods Pro (Bluetooth)" },
        { deviceId: "d", label: "USB Audio (0d8c:0014)" },
        { deviceId: "e", label: "USB Audio (0d8c:0014)" },
        { deviceId: "f", label: "Headset (a4-83-e7-1b-2c-3d)" },
        { deviceId: "g", label: "" },
      ]).values(),
    ]).toEqual([
      "MacBook Pro Microphone (Built-in)",
      "Yeti Stereo Microphone",
      "AirPods Pro (Bluetooth)",
      "USB Audio",
      "USB Audio 2",
      "Headset",
      "",
    ]);
  });
});

describe("pickableInputs", () => {
  it("leaves out the default and communications pseudo-devices", () => {
    expect(
      pickableInputs([
        ...devices,
        { deviceId: "communications", label: "Communications - Headset" },
        { deviceId: "", label: "" },
      ]).map((device) => device.deviceId),
    ).toEqual(["a1", "b2"]);
  });
});
