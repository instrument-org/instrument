import { z } from "zod";

/**
 * Whether the computer is online and Instrument's servers answer, kept in
 * main and shown as one pill in the window's corner; see
 * `docs/plans/network-status.md`.
 */
export const NetworkStatusSchema = z.enum([
  "online",
  "offline",
  "instrument-unreachable",
]);

export type NetworkStatus = z.output<typeof NetworkStatusSchema>;
