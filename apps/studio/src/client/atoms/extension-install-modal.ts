import { studioModalAtom } from "@/client/atoms/studio-modal";

/**
 * The Chrome Web Store's question before an extension is added, which main
 * asks every window (`browserExtensions.events.installAsked`):
 * `<ExtensionInstallModal />` at the window root reads it.
 */
export const extensionInstallModalAtom = studioModalAtom<{
  askId: string;
  icon: string;
  lines: string[];
  name: string;
}>();
