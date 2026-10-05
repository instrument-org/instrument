import "./styles/globals.css";

import { type ChatId } from "@instrument-org/workspace/client";
import ReactDOM, { type Root } from "react-dom/client";

import { App } from "./app";
import { FileSystemIconSpriteSheet } from "./components/extend/file-system";
import { AppWindow } from "./components/window/app-window";
import { initBrowserDownloadNotices } from "./lib/browser-download-notices";
import { initBrowserNavigationNotices } from "./lib/browser-navigation-notices";
import { initBrowserPool } from "./lib/browser-pool";
import {
  convertChatKeyedState,
  hasChatKeyedState,
  sessionsInChatKeyedState,
} from "./lib/chat-keyed-state";
import { initDebugRpcBridge } from "./lib/debug-rpc-bridge";
import { importLocalStorage } from "./lib/kept-state";
import { initRendererLogForwarding } from "./lib/forward-renderer-logs";
import { initStudioDrive } from "./lib/studio-drive";
import { rpcClient } from "./rpc/client";

declare global {
  var __studioRoot: Root | undefined;
}

initDebugRpcBridge();
initRendererLogForwarding();

/**
 * Moves the app window's kept state off chat sessions before anything reads
 * it: each session it names is asked once which chat it is. A session the
 * workspace cannot answer for stays as it was.
 */
async function convertKeptChatState() {
  if (!hasChatKeyedState(localStorage)) {
    return;
  }
  const chatOfSession = new Map<string, ChatId>();
  await Promise.all(
    sessionsInChatKeyedState(localStorage).map(async (sessionId) => {
      try {
        const { id } = await rpcClient.workspace.chats.ofSession.call({
          sessionId,
        });
        if (id) {
          chatOfSession.set(sessionId, id);
        }
      } catch {
        // Left as it was: the workspace could not say which chat it is.
      }
    }),
  );
  convertChatKeyedState(localStorage, chatOfSession);
}

async function start() {
  const rootElement = document.querySelector("#root");
  if (!rootElement) {
    return;
  }
  // The app window hosts its tabs in this one web contents
  // (AppWindow). The onboarding web contents uses the single-router
  // App.
  const isAppWindow = window.api.windowType === "app";
  if (isAppWindow) {
    await convertKeptChatState();
  }
  importLocalStorage(localStorage);

  let root = globalThis.__studioRoot;
  if (!root) {
    root = ReactDOM.createRoot(rootElement);
    globalThis.__studioRoot = root;
  }

  // Beside either root, the file browser's own type icons, drawn by
  // reference: a file named anywhere in any window (a reply's file chips, a
  // chat's marks) wears the same colored mark it has in the computer view.
  root.render(
    <>
      <FileSystemIconSpriteSheet />
      {isAppWindow ? <AppWindow /> : <App />}
    </>,
  );

  if (isAppWindow) {
    // Subscribe the browser webview pool to main-process mount/unmount
    // commands for the lifetime of the renderer: every browser guest is
    // mounted here.
    initBrowserPool();
    initBrowserDownloadNotices();
    initBrowserNavigationNotices();
    // The window's tabs, for driving scripts.
    initStudioDrive();
  }
}

void start();
