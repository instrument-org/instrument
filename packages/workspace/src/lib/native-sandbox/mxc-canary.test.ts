import { afterEach, describe, expect, it } from "vitest";

import { type Fault, runMxcCanary } from "./mxc-canary";
import {
  mxcCanaryLaunch,
  nativeSandboxEnforced,
  type NativeReach,
  wrapNativeCommand,
} from "./index";

/**
 * The canary against the real launcher, on Windows only, where
 * INSTRUMENT_TEST_MXC_EXEC names `wxc-exec.exe`. Run it in the interactive
 * session: over a bare SSH command every program importing USER32 fails to
 * start whatever the policy says, which reads as the canary failing.
 */
const exec = process.env.INSTRUMENT_TEST_MXC_EXEC;

describe.runIf(process.platform === "win32" && exec)(
  "the MXC canary on this machine",
  () => {
    const launcher = exec ?? "";
    const reach: NativeReach = {
      readOnly: [],
      readWrite: [],
      rules: {
        home: process.env.USERPROFILE ?? "",
        rules: [],
        dangerouslyAllowEveryFolder: false,
      },
    };

    afterEach(() => {
      delete process.env.INSTRUMENT_MXC;
      delete process.env.INSTRUMENT_MXC_CANARY_FAULT;
    });

    it("passes all three conditions", () => {
      expect(runMxcCanary(launcher, mxcCanaryLaunch(launcher))).toEqual({
        kind: "works",
      });
    });

    it.each<[Fault, string]>([
      ["grant", "a granted file did not read"],
      ["realpath", "drive-letter path"],
      ["refuse", "a closed folder could be read"],
    ])("fails when %s is forced to fail", (fault, reason) => {
      const verdict = runMxcCanary(launcher, mxcCanaryLaunch(launcher), fault);
      expect(verdict.kind).toBe("fails");
      expect(verdict.kind === "fails" && verdict.reason).toContain(reason);
    });

    it("holds native commands once the canary passed", () => {
      process.env.INSTRUMENT_MXC = "1";
      expect(wrapNativeCommand("cmd.exe", ["/c", "exit"], reach).kind).toBe(
        "mxc",
      );
      expect(nativeSandboxEnforced()).toBe(true);
    });

    it.each<Fault>(["grant", "realpath", "refuse"])(
      "runs native commands unwrapped when %s fails",
      (fault) => {
        process.env.INSTRUMENT_MXC = "1";
        process.env.INSTRUMENT_MXC_CANARY_FAULT = fault;
        const spawned = wrapNativeCommand("cmd.exe", ["/c", "exit"], reach);
        expect(spawned).toEqual({
          args: ["/c", "exit"],
          file: "cmd.exe",
          kind: "unwrapped",
          unheld: reach,
        });
        expect(nativeSandboxEnforced()).toBe(false);
      },
    );
  },
);
