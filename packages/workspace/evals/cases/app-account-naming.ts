/**
 * Does the agent name an app's account once its sign-in connects?
 *
 * Notion is set up and waiting on a sign-in. The user asks to connect it,
 * the card is answered as connected, and the sign-in learns no account, as
 * an MCP server's never does. The server has a `get_viewer` tool saying the
 * connection reaches the Staff Digital workspace. The note that wakes the
 * chat says the account is not named yet; the case is scored on whether the
 * app ends up named after the workspace and the reply says which one.
 */
import { getWorkspaceConfig } from "../../src/lib/workspace-config";
import { loadApp } from "../../src/lib/apps/store";
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

const WORKSPACE = "Staff Digital";

function lastAssistantText(sessions: Session.WithMessagesAndParts[]): string {
  const replies = sessions
    .flatMap((session) => session.messages)
    .filter((message) => message.role === "assistant");
  return (replies.at(-1)?.parts ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

const NAMED = `the app's account is named ${WORKSPACE}`;

const named: Assertion = {
  check: async () => {
    const loaded = await loadApp(getWorkspaceConfig().appsDir, "notion");
    const account = loaded.isOk() ? loaded.value.manifest.account : undefined;
    return {
      evidence: account ?? "no account named",
      passed: account === WORKSPACE,
      text: NAMED,
    };
  },
  text: NAMED,
};

const TOLD = `the reply after the sign-in names ${WORKSPACE}`;

const told: Assertion = {
  check: ({ sessions }) => {
    const text = lastAssistantText(sessions);
    return {
      evidence: text.slice(-300) || "no reply",
      passed: text.includes(WORKSPACE),
      text: TOLD,
    };
  },
  text: TOLD,
};

export const APP_ACCOUNT_NAMING_EVALS = [
  defineEval({
    apps: [
      {
        kind: "sign-in",
        name: "Notion",
        slug: "notion",
        viewer: {
          user: { email: "neil@example.com", name: "Neil" },
          workspace: { name: WORKSPACE },
        },
      },
    ],
    assertions: [named, told],
    kind: "chat",
    name: "app-account-named-after-sign-in",
    prompt:
      "Connect my Notion so you can look things up there later. Just get it connected for now.",
    signInsAnswerAs: {},
  }),
];
