/**
 * Environment that would run Claude Code on something other than the Claude
 * account Instrument signed it in to: an API key or token, which wins over
 * the account without a word, another endpoint, or a cloud provider.
 */
const SCRUBBED = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_VERTEX",
  // Skips the OAuth sign-in, so the account would not be used.
  "CLAUDE_CODE_SIMPLE",
];

/**
 * Environment that would override what Instrument asks of Claude Code: an
 * effort level that wins over the one each request sets, and a timeout on
 * every MCP call, which would fail any of our tools that runs longer.
 */
const OVERRIDES = ["CLAUDE_CODE_EFFORT_LEVEL", "MCP_TOOL_TIMEOUT"];

/**
 * The environment Instrument runs Claude Code in, for every request and every
 * status check alike: this process's own, less anything in `SCRUBBED` or
 * `OVERRIDES`, with the config folder holding the account's sign-in when
 * there is one.
 */
export function claudeCodeEnvironment(
  configDir: string | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      !SCRUBBED.includes(name) &&
      !OVERRIDES.includes(name)
    ) {
      env[name] = value;
    }
  }
  if (configDir) {
    env.CLAUDE_CONFIG_DIR = configDir;
  }
  // Claude Code cuts an MCP tool's description at 2,048 characters and its
  // result at 25,000 tokens. Our tools are served to it over MCP, and some of
  // their descriptions run far longer, so the model would see a different
  // tool than every other provider does. Our tools cap their own output.
  env.CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH = "1000000";
  env.MAX_MCP_OUTPUT_TOKENS = "1000000";
  // Our loop keeps the context: Claude Code must neither summarize our
  // history on its own nor tell the model a token budget of its own.
  env.DISABLE_AUTO_COMPACT = "1";
  env.CLAUDE_CODE_TOTAL_TOKENS_REMINDER = "off";
  // Features of Claude Code's own that Instrument has its own version of, or
  // that would act on the account where the person cannot see it: notes it
  // keeps between sessions, recaps of an idle session, asking a stronger
  // model mid-task, and hiding MCP tools (all of ours) behind a search.
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  env.CLAUDE_CODE_ENABLE_AWAY_SUMMARY = "0";
  env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL = "1";
  env.ENABLE_TOOL_SEARCH = "false";
  return env;
}
