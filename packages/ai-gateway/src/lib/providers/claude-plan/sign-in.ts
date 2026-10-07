import { z } from "zod";

/** A Claude sign-in Claude Code has started, waiting on the person. */
export interface ClaudeCodeSignIn {
  /** Ends the sign-in and its process, when the person gives up. */
  cancel: () => void;
  /** Settles once Claude Code has stored the sign-in, or failed to. */
  completion: Promise<void>;
  /**
   * Anthropic's sign-in page for a browser on another device, or one that
   * cannot reach this computer: it ends on a page showing a code, which the
   * person copies back here.
   */
  linkForAnotherDevice: string;
  /**
   * Hands Claude Code the code that page showed. Claude Code exchanges it
   * with the secret it holds for this sign-in, so the code is no use to
   * anything else; it is passed straight on and kept nowhere.
   */
  submitCode: (pasted: string) => Promise<void>;
  /**
   * Anthropic's sign-in page for this computer's own browser. It returns to a
   * port Claude Code itself listens on, so the result reaches Claude Code and
   * nothing else.
   */
  url: string;
}

const StartedSchema = z.object({
  automaticUrl: z.string().url(),
  manualUrl: z.string().url(),
});

/**
 * Start Claude Code's own claude.ai sign-in, the one its IDE integrations use,
 * from a process of its own. The sign-in is Anthropic's from end to end: their
 * page, their client, and Claude Code exchanging what comes back and storing
 * it where every copy of it reads from. This only opens the page, and passes
 * on a pasted code when the browser could not get back on its own.
 *
 * The SDK carries these requests without typing them, so they are reached by
 * name and their answers checked here; an SDK that drops them fails the start,
 * and the caller falls back to Claude Code's sign-in in a terminal.
 */
export async function startClaudeCodeSignIn({
  configDir,
  executablePath,
}: {
  configDir: string | undefined;
  executablePath: string;
}): Promise<ClaudeCodeSignIn> {
  const { ClaudePlanSession } = await import("./session");
  const session = new ClaudePlanSession(
    "sign-in",
    {
      builtInTools: [],
      configDir,
      effort: undefined,
      executablePath,
      modelId: "default",
      systemPrompt: "",
      tools: [],
    },
    () => {},
  );
  try {
    const started = StartedSchema.parse(
      await session.control("claudeAuthenticate", true),
    );
    const completion = session
      .control("claudeOAuthWaitForCompletion")
      .then(() => undefined)
      .finally(() => {
        session.close();
      });
    const stateOfLink = new URL(started.manualUrl).searchParams.get("state");
    return {
      cancel: () => {
        session.close();
      },
      completion,
      linkForAnotherDevice: started.manualUrl,
      submitCode: async (pasted) => {
        const { code, state } = splitPastedCode(pasted, stateOfLink);
        await session.control("claudeOAuthCallback", code, state);
      },
      url: started.automaticUrl,
    };
  } catch (error) {
    session.close();
    throw error;
  }
}

/**
 * Anthropic's code page shows the code and the sign-in's state joined by a
 * `#`, as Claude Code's own terminal sign-in expects them pasted. A code
 * pasted without it takes the state from the link it came from.
 */
export function splitPastedCode(pasted: string, stateOfLink: string | null) {
  const [code = "", state] = pasted.trim().split("#", 2);
  if (!code) {
    throw new Error("That doesn't look like a sign-in code.");
  }
  const resolvedState = state ?? stateOfLink;
  if (!resolvedState) {
    throw new Error("That code is missing the part after the #.");
  }
  return { code, state: resolvedState };
}
