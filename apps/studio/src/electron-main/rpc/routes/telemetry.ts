import { base } from "@/electron-main/rpc/base";
import { getMachineState } from "@/electron-main/stores/machine/state";
import { z } from "zod";

const getId = base.output(z.object({ id: z.string() })).handler(() => {
  return { id: getMachineState().get("telemetryId") };
});

export const telemetry = {
  getId,
};
