/**
 * The contract between the guest preload and the editor bundle it runs: what
 * the preload hands over (the boot answer and a channel to the window) on
 * the isolated world's global, where the page's scripts cannot reach it.
 */
import {
  type PageEditorGuestMessage,
  type PageEditorHostMessage,
} from "@/shared/page-editor-messages";

/** Main's answer to the boot question when the load is an edit. */
export interface PageEditorBoot {
  bundle: string;
  /** The file's name, for what the agent reads. */
  name: string;
  /** The file's text as loaded, before the ids were stamped on. */
  src: string;
  /** What the previous load of this edit handed over, or what the window started it with. */
  state: unknown;
  version: string;
}

export interface PageEditorBridge {
  boot: PageEditorBoot;
  listen: (handler: (message: PageEditorHostMessage) => void) => void;
  send: (message: PageEditorGuestMessage) => void;
}

declare global {
  interface Window {
    __instrumentPageEditor?: PageEditorBridge;
  }
}
