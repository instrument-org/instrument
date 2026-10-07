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
  return env;
}
