import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { getWorkspaceConfig } from "../workspace-config";
import { type AppConnection, readConnection } from "./connection";
import { loadApp } from "./store";

type SignInProgress = SessionMessageDataPart.SignInProgress;

/** An app with a row on a sign-in card. */
interface CardApp {
  name: string;
  slug: string;
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
 * Every app on a card as its connection now stands, in the card's order. An
 * app whose folder or connection is gone since the card asked has no row
 * left to answer, so it is left out; undefined when none is left.
 */
export async function signInProgress(
  card: CardApp[],
): Promise<SignInProgress | undefined> {
  const { appsDir } = getWorkspaceConfig();
  const rows = await Promise.all(
    card.map(async ({ slug }) => {
      const [connection, loaded] = await Promise.all([
        readConnection(slug),
        loadApp(appsDir, slug),
      ]);
      if (connection === undefined || loaded.isErr()) {
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
