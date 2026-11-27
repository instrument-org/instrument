import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { type AppConnection, readConnection } from "./connection";
import { loadApp } from "./store";
import { grokPlanSignedIn } from "./x-site";

type SignInProgress = SessionMessageDataPart.SignInProgress;

/** An app with a row on a sign-in card. */
interface CardApp {
  name: string;
  /** For an X app's row asking for the Grok plan its search runs on. */
  plan?: "grok";
  slug: string;
  /** Where the row stood when the card was last written, which a plan row's decline is kept in. */
  standing?: SignInProgress[number]["standing"];
}

/** How an app's connection reads on its card's row. */
function standingOf(
  connection: AppConnection,
): SignInProgress[number]["standing"] {
  switch (connection.status) {
    case "connected":
    case "declined":
    case "failed": {
      return connection.status;
    }
    case "needs-approval":
    case "needs-key":
    case "needs-sign-in": {
      return "waiting";
    }
  }
}

/**
 * A row asking for the Grok plan: answered once a plan is signed in on this
 * computer, or once the user turned the row down, which the card itself
 * keeps. The app's own connection is its site's, which the row neither
 * asks for nor writes.
 */
function planStanding(
  row: CardApp,
): SignInProgress[number]["standing"] {
  if (grokPlanSignedIn()) {
    return "connected";
  }
  return row.standing === "declined" ? "declined" : "waiting";
}

/**
 * Every app on a card as its connection now stands (a plan row, as the plan
 * does), in the card's order. An
 * app or connection that is gone since the card asked has no row
 * left to answer, so it is left out; undefined when none is left.
 */
export async function signInProgress(
  card: CardApp[],
): Promise<SignInProgress | undefined> {
  const rows = await Promise.all(
    card.map(async (row) => {
      const { plan, slug } = row;
      const [connection, loaded] = await Promise.all([
        readConnection(slug),
        loadApp(slug),
      ]);
      if (loaded.isErr()) {
        return [];
      }
      if (plan !== undefined) {
        return [
          {
            name: loaded.value.name,
            plan,
            slug,
            standing: planStanding(row),
          },
        ];
      }
      if (connection === undefined) {
        return [];
      }
      const standing = standingOf(connection);
      const account =
        standing === "connected"
          ? (connection.account ?? loaded.value.manifest.account)
          : undefined;
      return [
        {
          ...(account === undefined ? {} : { account }),
          name: loaded.value.name,
          slug,
          standing,
        },
      ];
    }),
  );
  const progress = rows.flat();
  return progress.length === 0 ? undefined : progress;
}
