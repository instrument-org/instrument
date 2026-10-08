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
];

/**
 * The environment Instrument runs Claude Code in, for every request and every
 * status check alike: this process's own, less anything in `SCRUBBED`, with
 * the config folder holding the account's sign-in when there is one.
 */
export function claudeCodeEnvironment(
  configDir: string | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !SCRUBBED.includes(name)) {
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
  return env;
}
