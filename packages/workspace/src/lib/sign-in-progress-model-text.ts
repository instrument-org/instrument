import { type SessionMessageDataPart } from "../schemas/session/message-data-part";

type SignInProgress = SessionMessageDataPart.SignInProgress;

const HEADINGS: Record<SignInProgress[number]["standing"], string> = {
  connected: "connected",
  declined: "skipped by the user",
  failed: "did not connect",
  waiting: "not answered yet",
};

/**
 * Where the apps on a sign-in card stand, in one line for a note: each
 * standing with its apps, and the account a connected one is signed in as.
 */
export function signInProgressLine(progress: SignInProgress): string {
  const groups = (["connected", "declined", "failed", "waiting"] as const)
    .map((standing) => {
      const apps = progress.filter((app) => app.standing === standing);
      if (apps.length === 0) {
        return undefined;
      }
      const named = apps
        .map(
          (app) =>
            `${app.name} (${app.slug})${app.account === undefined ? "" : ` as ${app.account}`}`,
        )
        .join(", ");
      return `${HEADINGS[standing]}: ${named}`;
    })
    .filter((group) => group !== undefined);
  return `${groups.join("; ")}.`;
}

/** Whether every app on a card is answered: connected or skipped. */
export function signInsSettled(progress: SignInProgress): boolean {
  return progress.every(
    (app) => app.standing === "connected" || app.standing === "declined",
  );
}
