import { useLiveEntitlements } from "./use-live-entitlements";

export function useHasLifetime(): boolean {
  const { data: entitlements } = useLiveEntitlements();
  return entitlements?.lifetime ?? false;
}

export function useHasPremium(): boolean {
  const { data: entitlements } = useLiveEntitlements();
  return entitlements?.premium ?? false;
}
