import { getExternalAppLinksStore } from "@/electron-main/stores/workspace/external-app-links";
import {
  app,
  BrowserWindow,
  dialog,
  type MessageBoxOptions,
  type WebContents,
} from "electron";

// Guests with a question on screen. A page firing its link again while one is
// open is refused rather than stacking a second sheet on the window.
const asking = new Set<number>();

/**
 * The question a page's link to another app puts to the person, or null when
 * no app on the computer opens it, since then there is nothing to ask. `site`
 * is the page's host, null for a page with none (a file on the computer),
 * which is asked each time because "always" would cover every such page.
 */
export function questionOf(
  appName: string,
  site: null | string,
): MessageBoxOptions | null {
  const name = appName.replace(/\.app$/, "");
  if (!name) {
    return null;
  }
  return {
    buttons: ["Cancel", `Open ${name}`],
    cancelId: 0,
    ...(site
      ? { checkboxLabel: `Always let ${site} open links in ${name}` }
      : {}),
    defaultId: 1,
    detail: `${site ?? "This page"} wants to open this link in ${name}.`,
    message: `Open ${name}?`,
    noLink: true,
  };
}

/**
 * Asks whether the page in `wc` may hand `externalURL` to the app that opens
 * it, unless the person already said its site always may for that kind of
 * link. Answers false when nothing opens it or a question is already open.
 */
export async function askToOpenInAnotherApp(
  wc: WebContents,
  externalURL: string,
  requestingUrl: string,
): Promise<boolean> {
  const scheme = URL.parse(externalURL)?.protocol;
  if (!scheme) {
    return false;
  }
  const page = URL.parse(requestingUrl);
  const remembered =
    page?.host && page.origin !== "null"
      ? { origin: page.origin, scheme }
      : null;
  const store = getExternalAppLinksStore();
  if (
    remembered &&
    store
      .get("allowed")
      .some(
        ({ origin, scheme: allowed }) =>
          origin === remembered.origin && allowed === scheme,
      )
  ) {
    return true;
  }
  const question = questionOf(
    app.getApplicationNameForProtocol(externalURL),
    remembered ? (page?.host ?? null) : null,
  );
  if (!question || asking.has(wc.id)) {
    return false;
  }
  asking.add(wc.id);
  try {
    const host = wc.hostWebContents;
    const win = host ? BrowserWindow.fromWebContents(host) : null;
    const { checkboxChecked, response } = await (win
      ? dialog.showMessageBox(win, question)
      : dialog.showMessageBox(question));
    if (response !== 1) {
      return false;
    }
    if (checkboxChecked && remembered) {
      store.set("allowed", [...store.get("allowed"), remembered]);
    }
    return true;
  } finally {
    asking.delete(wc.id);
  }
}
