import { z } from "zod";

/** A Claude sign-in Claude Code has started, waiting on the person's browser. */
export interface ClaudeCodeSignIn {
  /** Ends the sign-in and its process, when the person gives up. */
  cancel: () => void;
  /** Settles once Claude Code has stored the sign-in, or failed to. */
  completion: Promise<void>;
  /**
   * Anthropic's sign-in page. It returns the browser to a port Claude Code
   * itself listens on, so the result reaches Claude Code and nothing else.
   */
  url: string;
}

const StartedSchema = z.object({ automaticUrl: z.string().url() });

/**
 * Start Claude Code's own claude.ai sign-in, the one its IDE integrations use,
 * from a process of its own. The sign-in is Anthropic's from end to end: their
 * page, their client, and a callback to Claude Code, which stores what comes
 * back where every copy of it reads from. This only opens the page.
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
    return {
      cancel: () => {
        session.close();
      },
      completion,
      url: started.automaticUrl,
    };
  } catch (error) {
    session.close();
    throw error;
  }
}
