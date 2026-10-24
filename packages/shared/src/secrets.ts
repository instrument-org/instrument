/**
 * Finds credentials in text by their shape, for what is about to leave the
 * computer or reach disk: a report, a log line, a memory, an app's files.
 *
 * Provider rules are ported from secretlint's recommended preset (MIT,
 * https://github.com/secretlint/secretlint, v13.0.7) and two from gitleaks'
 * default config (MIT, https://github.com/gitleaks/gitleaks): the Google API
 * key and the JWT, which secretlint has no rule for. The rest are ours.
 * Every rule is a pattern alone, so the whole set runs synchronously, which a
 * log hook needs. gitleaks' catch-all "generic API key" rule is left out on
 * purpose: on ordinary source code it matches variable names, which in a
 * report would erase the tool output a reader needs.
 */

type SecretRule = {
  /** Only the match's first capture group is the secret; the rest stays. */
  group?: true;
  /** Text that must appear, in any case, for the pattern to be worth running. */
  keywords: readonly string[];
  label: string;
  pattern: RegExp;
  /** A further check on the secret itself, past the pattern. */
  plausible?: (secret: string) => boolean;
};

/** Where a secret is in a text, and what it looks like. */
export type SecretMatch = { end: number; label: string; start: number };

/** A value written as a template rather than a value: `${VAR}`, `{{var}}`, `$VAR`. */
function isPlaceholder(value: string) {
  return (
    /\$\{[^}]{1,50}\}|\{\{[^}]{1,50}\}\}|\{[^}]{1,50}\}|%[A-Z_]{1,30}%|\$[A-Z_]{1,30}|\$\([^)]{1,50}\)/.test(
      value,
    ) ||
    /^(?:password|passwd|pass|secret|xxx+|\*+)$/i.test(value) ||
    /^(.)\1{3,}$/.test(value)
  );
}

/** Whether a run has both letters and digits, as a generated key does. */
function isMixed(value: string) {
  return /\d/.test(value) && /[A-Za-z]/.test(value);
}

const SECRET_RULES: readonly SecretRule[] = [
  {
    keywords: ["T3BlbkFJ"],
    label: "OpenAI key",
    pattern:
      /sk-(?:proj|svcacct|admin)-(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})T3BlbkFJ(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})\b|sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20}/g,
  },
  {
    // secretlint matches `sk-ant-api0N-` keys; this also takes the OAuth
    // tokens a Claude account signs in with (`sk-ant-oat01-`).
    keywords: ["sk-ant-"],
    label: "Anthropic key",
    pattern: /(?<!\p{L})sk-ant-[a-z]{3}\d{2}-[A-Za-z0-9_-]{32,}/gu,
  },
  // The AI providers the app takes a key for, by the prefix each one's keys
  // start with (`keyFormat` in ai-gateway's provider metadata). A key the
  // person pasted into a chat or a `.env` is theirs to keep out of a report.
  {
    keywords: ["sk-or-"],
    label: "OpenRouter key",
    pattern: /(?<!\p{L})sk-or-v\d+-[A-Za-z0-9]{32,}(?![A-Za-z0-9])/gu,
  },
  {
    keywords: ["sk-api-"],
    label: "MiniMax key",
    pattern: /(?<!\p{L})sk-api-[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/gu,
  },
  {
    keywords: ["xai-"],
    label: "xAI key",
    pattern: /(?<!\p{L})xai-[A-Za-z0-9]{32,}(?![A-Za-z0-9])/gu,
    plausible: isMixed,
  },
  {
    keywords: ["csk-"],
    label: "Cerebras key",
    pattern: /(?<!\p{L})csk-[A-Za-z0-9]{32,}(?![A-Za-z0-9])/gu,
    plausible: isMixed,
  },
  {
    keywords: ["fw_"],
    label: "Fireworks key",
    pattern: /(?<!\p{L})fw_[A-Za-z0-9]{20,}(?![A-Za-z0-9])/gu,
    plausible: isMixed,
  },
  {
    keywords: ["gsk_"],
    label: "Groq key",
    pattern: /(?<!\p{L})gsk_[a-zA-Z0-9]{52}(?![a-zA-Z0-9])/gu,
  },
  {
    keywords: ["hf_"],
    label: "Hugging Face token",
    pattern: /(?<!\p{L})hf_[a-zA-Z]{34}(?![a-zA-Z])/gu,
  },
  {
    keywords: ["lin_api_"],
    label: "Linear key",
    pattern: /(?<!\p{L})lin_api_[a-zA-Z0-9_]{32,128}(?![a-zA-Z0-9_])/gu,
  },
  {
    keywords: ["ntn_"],
    label: "Notion token",
    pattern: /(?<!\p{L})ntn_[0-9]{11}[A-Za-z0-9]{35}(?![A-Za-z0-9])/gu,
  },
  {
    keywords: ["SG."],
    label: "SendGrid key",
    pattern: /(?<!\p{L})SG\.\w{1,128}\.\w{1,128}[-_]?\w{1,128}(?!\w)/gu,
  },
  {
    keywords: ["shp"],
    label: "Shopify token",
    pattern:
      /(?<!\p{L})(?:shppa|shpca|shpat|shpss)_[a-zA-Z0-9]{32,64}(?![a-zA-Z0-9])/gu,
  },
  {
    keywords: ["_live_", "_test_"],
    label: "Stripe key",
    pattern:
      /(?<!\p{L})(?:sk_live|sk_test|rk_live|rk_test)_[a-zA-Z0-9]{24,99}(?![a-zA-Z0-9])/gu,
  },
  {
    keywords: ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"],
    label: "GitHub token",
    pattern:
      /(?<!\p{L})(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36}(?![A-Za-z0-9_])/gu,
  },
  {
    keywords: ["github_pat_"],
    label: "GitHub token",
    pattern: /(?<!\p{L})github_pat_[A-Za-z0-9_]{82}(?![A-Za-z0-9_])/gu,
  },
  {
    keywords: ["glpat-"],
    label: "GitLab token",
    pattern: /(?<!\p{L})glpat-[A-Za-z0-9_-]{20,128}(?![A-Za-z0-9_-])/gu,
  },
  {
    keywords: ["glsa_"],
    label: "Grafana token",
    pattern: /(?<!\p{L})glsa_[A-Za-z0-9]{32}_[A-Fa-f0-9]{8}(?![A-Fa-f0-9])/gu,
  },
  {
    keywords: ["ops_ey"],
    label: "1Password token",
    pattern:
      /(?<!\p{L})ops_ey[A-Za-z0-9+/=]{100,1280}fQ={0,2}(?![A-Za-z0-9+/=])/gu,
  },
  {
    keywords: ["hvs.", "hvb.", "hvr."],
    label: "Vault token",
    pattern:
      /(?<!\p{L})(?:hvs\.[A-Za-z0-9_-]{90,120}|hvb\.[A-Za-z0-9_-]{138,300}|hvr\.[A-Za-z0-9_-]{90,120})(?![A-Za-z0-9_-])/gu,
  },
  {
    keywords: ["vcp_", "vci_", "vca_", "vcr_", "vck_"],
    label: "Vercel token",
    pattern:
      /(?<!\p{L})(?:vcp|vci|vca|vcr|vck)_[A-Za-z0-9]{20,60}(?![A-Za-z0-9])/gu,
  },
  {
    keywords: ["dapi"],
    label: "Databricks token",
    pattern: /(?<!\p{L})dapi[A-Fa-f0-9]{32}(?:-[0-9])?(?![A-Fa-f0-9])/gu,
  },
  {
    keywords: ["dckr_pat_"],
    label: "Docker token",
    pattern: /(?<!\p{L})dckr_pat_[a-zA-Z0-9_-]{27}(?![a-zA-Z0-9_-])/gu,
  },
  {
    keywords: ["figd_"],
    label: "Figma token",
    pattern: /(?<!\p{L})figd_[A-Za-z0-9_-]{40,200}(?![A-Za-z0-9_-])/gu,
  },
  {
    keywords: ["cfk_", "cfut_", "cfat_"],
    label: "Cloudflare token",
    pattern:
      /(?<!\p{L})(?:cfk|cfut|cfat)_[A-Za-z0-9]{40}[0-9a-f]{8}(?![A-Za-z0-9])/gu,
  },
  {
    keywords: ["tskey-"],
    label: "Tailscale key",
    pattern:
      /(?<!\p{L})tskey-[a-z]{2,20}-[0-9A-Za-z_]{8,40}-[0-9A-Za-z_]{16,60}(?![0-9A-Za-z_])/gu,
  },
  {
    keywords: ["xox", "xapp-"],
    label: "Slack token",
    pattern:
      /\b(?:xoxb|xoxp|xapp|xoxa|xoxo|xoxr)-(?:\d-)?(?:[a-zA-Z0-9]{1,40}-)+[a-zA-Z0-9]{1,40}\b/g,
  },
  {
    keywords: ["hooks.slack.com"],
    label: "Slack webhook",
    pattern:
      /https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9]{1,40}\/B[a-zA-Z0-9]{1,40}\/[a-zA-Z0-9]{1,40}/gi,
  },
  {
    keywords: ["npm_"],
    label: "npm token",
    pattern: /(?<!\p{L})npm_[A-Za-z0-9_]{36}(?![A-Za-z0-9_])/gu,
  },
  {
    group: true,
    keywords: ["_authToken="],
    label: "npm token",
    pattern: /_authToken=([^$\s][^\s]*)/g,
  },
  {
    keywords: [
      "A3T",
      "AKIA",
      "AGPA",
      "AIDA",
      "AROA",
      "AIPA",
      "ANPA",
      "ANVA",
      "ASIA",
    ],
    label: "AWS access key",
    pattern:
      /\b(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    group: true,
    keywords: ["secret"],
    label: "AWS secret key",
    pattern:
      /["']?(?:AWS|aws|Aws)?_?(?:SECRET|secret|Secret)_?(?:ACCESS|access|Access)_?(?:KEY|key|Key)["']?\s*(?::|=>|=)\s*["']?([A-Za-z0-9/+=]{40})["']?\b/g,
  },
  {
    keywords: ["PRIVATE KEY"],
    label: "private key",
    pattern:
      /-----BEGIN[ A-Z]{0,20}PRIVATE KEY(?: BLOCK)?-----[\s\S]{0,10000}?-----END[ A-Z]{0,20}PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    // secretlint's basic auth and database connection rules, as one: the
    // password in any `scheme://user:password@` stays out, the address stays.
    group: true,
    keywords: ["://"],
    label: "password",
    pattern:
      /\b[a-z][a-z0-9+.-]{1,31}:\/\/[^\s/@:"'`]{1,256}:([^\s/@"'`]{1,256})@/gi,
    plausible: (password) => password.length >= 4 && !isPlaceholder(password),
  },
  {
    // From gitleaks.
    group: true,
    keywords: ["AIza"],
    label: "Google API key",
    pattern: /\b(AIza[\w-]{35})(?:[`'"\s;]|\\[nr]|$)/g,
  },
  {
    // From gitleaks.
    group: true,
    keywords: ["ey"],
    label: "JWT",
    pattern:
      /\b(ey[a-zA-Z0-9]{17,}\.ey[a-zA-Z0-9/\\_-]{17,}\.(?:[a-zA-Z0-9/\\_-]{10,}={0,2})?)(?:[`'"\s;]|\\[nr]|$)/g,
  },
  {
    group: true,
    keywords: ["earer"],
    label: "bearer token",
    pattern: /\b[Bb]earer\s+([A-Za-z0-9._~+/-]{16,}=*)/g,
    plausible: (token) => !isPlaceholder(token),
  },
  {
    group: true,
    keywords: ["key", "token", "secret", "password"],
    label: "credential",
    pattern:
      /["'`]?(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)["'`]?\s*[:=]\s*["'`]([^"'`\s]{16,})["'`]/gi,
    plausible: (secret) => !isPlaceholder(secret),
  },
  {
    // Last, so a key a rule above names keeps its own label: an older OpenAI
    // key, and DeepSeek's and OpenCode Zen's, are `sk-` and a run.
    keywords: ["sk-"],
    label: "API key",
    pattern: /(?<!\p{L})sk-[A-Za-z0-9]{32,}(?![A-Za-z0-9])/gu,
    plausible: isMixed,
  },
];

/**
 * The rules as they run: keywords lowered to match the lowered text, and a
 * rule whose secret is a capture group asked for that group's place.
 */
const RULES = SECRET_RULES.map((rule) => ({
  ...rule,
  keywords: rule.keywords.map((keyword) => keyword.toLowerCase()),
  pattern: rule.group
    ? new RegExp(rule.pattern.source, `${rule.pattern.flags}d`)
    : rule.pattern,
}));

/**
 * Every secret in `text`, in order, none overlapping: where one rule's match
 * overlaps an earlier one's, the earlier, then the longer, stands.
 */
export function findSecrets(text: string): SecretMatch[] {
  const found: SecretMatch[] = [];
  const lower = text.toLowerCase();
  for (const rule of RULES) {
    if (!rule.keywords.some((keyword) => lower.includes(keyword))) {
      continue;
    }
    for (const match of text.matchAll(rule.pattern)) {
      const [start, end] = (rule.group ? match.indices?.[1] : undefined) ?? [
        match.index,
        match.index + match[0].length,
      ];
      if (rule.plausible && !rule.plausible(text.slice(start, end))) {
        continue;
      }
      found.push({ end, label: rule.label, start });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: SecretMatch[] = [];
  for (const match of found) {
    const last = kept.at(-1);
    if (!last || match.start >= last.end) {
      kept.push(match);
    }
  }
  return kept;
}

/** `text` with each secret in it written `[secret: <what it is>]`. */
export function redactSecrets(text: string): string {
  const secrets = findSecrets(text);
  if (secrets.length === 0) {
    return text;
  }
  let out = "";
  let at = 0;
  for (const { end, label, start } of secrets) {
    out += `${text.slice(at, start)}[secret: ${label}]`;
    at = end;
  }
  return out + text.slice(at);
}

/**
 * A web address's query and fragment, which carry sign-in codes, session
 * tokens and tracking ids far more often than anything a reader of a log
 * needs. Bounded runs keep it linear on long lines.
 */
const URL_QUERY_PATTERN =
  /(\bhttps?:\/\/[^\s?#"'`<>]{1,2048})[?#][^\s"'`<>]{0,8192}?(?=[.,;:!)\]]*(?:[\s"'`<>]|$))/gi;

/** `text` with every web address's query and fragment written `?[query]`. */
export function redactUrlQueries(text: string): string {
  if (!text.includes("://")) {
    return text;
  }
  return text.replaceAll(URL_QUERY_PATTERN, "$1?[query]");
}
