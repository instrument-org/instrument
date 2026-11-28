import { studioModalAtom } from "@/client/atoms/studio-modal";

/**
 * A question about an extension, before one is added or removed from the
 * Chrome Web Store's page or when one asks to be allowed more, which main asks every window (`browserExtensions.events.installAsked`):
 * `<ExtensionInstallModal />` at the window root reads it.
 */
export const extensionInstallModalAtom = studioModalAtom<{
  askId: string;
  icon: null | string;
  kind: "add" | "allow-more" | "remove";
  lines: string[];
  name: string;
  unsupported: string[];
}>();
