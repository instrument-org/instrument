import { isDeveloperMode } from "@/electron-main/stores/preferences";
import {
  clipboard,
  type ContextMenuParams,
  Menu,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import { noop } from "radashi";

// Injected into the guest page: mouse thumb buttons are delivered to the page's
// DOM, so traverse the guest's own history from there. Re-injected on each load;
// the flag guards against adding the listener twice in one document.
const MOUSE_NAV_SCRIPT = `(() => {
  if (window.__instrumentMouseNav) return;
  window.__instrumentMouseNav = true;
  const offset = (e) => (e.button === 3 ? -1 : e.button === 4 ? 1 : 0);
  addEventListener('mousedown', (e) => {
    if (offset(e)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  addEventListener('mouseup', (e) => {
    const d = offset(e);
    if (d && e.isTrusted) { e.preventDefault(); e.stopPropagation(); history.go(d); }
  }, true);
})();`;

/** Wire user input the agent-browser guest needs to be usable directly: mouse
 * thumb-button navigation and a right-click context menu. */
export function attachGuestInteractions(guest: WebContents) {
  guest.on("did-finish-load", () => {
    void guest.executeJavaScript(MOUSE_NAV_SCRIPT).catch(noop);
  });

  guest.on("context-menu", (_event, params) => {
    Menu.buildFromTemplate(contextMenuTemplate(guest, params)).popup();
  });
}

function contextMenuTemplate(
  guest: WebContents,
  params: ContextMenuParams,
): MenuItemConstructorOptions[] {
  const { editFlags } = params;
  const items: MenuItemConstructorOptions[] = [
    {
      click: () => { guest.navigationHistory.goBack(); },
      enabled: guest.navigationHistory.canGoBack(),
      label: "Back",
    },
    {
      click: () => { guest.navigationHistory.goForward(); },
      enabled: guest.navigationHistory.canGoForward(),
      label: "Forward",
    },
    { click: () => { guest.reload(); }, label: "Reload" },
    { type: "separator" },
  ];

  if (params.linkURL) {
    items.push(
      { click: () => { clipboard.writeText(params.linkURL); }, label: "Copy Link" },
      { type: "separator" },
    );
  }

  if (params.isEditable || params.selectionText) {
    items.push(
      { enabled: editFlags.canCut, label: "Cut", role: "cut" },
      { enabled: editFlags.canCopy, label: "Copy", role: "copy" },
      { enabled: editFlags.canPaste, label: "Paste", role: "paste" },
      { type: "separator" },
      { label: "Select All", role: "selectAll" },
    );
  } else {
    items.push({ enabled: editFlags.canCopy, label: "Copy", role: "copy" });
  }

  if (isDeveloperMode()) {
    items.push(
      { type: "separator" },
      {
        click: () => { guest.inspectElement(params.x, params.y); },
        label: "Inspect Element",
      },
    );
  }

  return items;
}
