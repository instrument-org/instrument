import { type TabId, TabIdSchema } from "@/shared/tabs";

/**
 * The impure half of the tabs model: the pure transitions in
 * {@link tabs-model} stay id-injecting and side-effect free, and this is the
 * one layer that reaches for a fresh id.
 */
export function freshTabId(): TabId {
  return TabIdSchema.parse(crypto.randomUUID());
}
