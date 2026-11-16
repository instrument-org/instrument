import { appKey, appsStore } from "../../lib/apps/store";
import { AppSlugSchema } from "../../lib/apps/manifest";

/**
 * Puts an app in the apps store as a test needs it, setup and all, whether
 * or not this build reads the setup as a manifest.
 */
export async function seedApp(
  slug: string,
  {
    guide = "",
    name,
    setup,
  }: { guide?: string; name: string; setup: Record<string, unknown> },
): Promise<void> {
  const store = await appsStore();
  await store.apply([
    {
      key: appKey(AppSlugSchema.parse(slug)),
      t: "set",
      value: { guide, name, setup },
    },
  ]);
}

/** Takes every app and icon out of the apps store, for a test that starts with none. */
export async function forgetApps(): Promise<void> {
  const store = await appsStore();
  await store.apply(
    [...store.entries().keys()].map((key) => ({ key, t: "del" as const })),
  );
}
