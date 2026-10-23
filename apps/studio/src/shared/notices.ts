import { z } from "zod";

/**
 * A notice from us, as `GET /notices` on the reports service sends it: a
 * build that can't update itself, a security fix, what's new, an
 * announcement, or a problem the person reported that's now fixed. Which
 * versions, platforms, channels and accounts one is for is the service's to
 * decide; none of that reaches the app.
 */
export const NoticeSchema = z.object({
  /**
   * A link, or a page of Settings to open. An action this build can't read
   * is dropped rather than the notice, so the service can add kinds of it.
   */
  action: z
    .union([
      z.object({ label: z.string(), url: z.url() }),
      z.object({
        label: z.string(),
        setting: z.string().optional(),
        settings: z.enum(["Account", "Permissions", "Providers"]),
      }),
    ])
    .optional()
    .catch(undefined),
  body: z.string(),
  endsAt: z.iso.datetime().optional(),
  id: z.string().min(1),
  kind: z.enum(["account", "update", "whats-new", "announcement", "security"]),
  publishedAt: z.iso.datetime(),
  /**
   * How loud it is: `info` is a dot on the bell, `important` adds one toast,
   * `critical` adds one toast that stays until it's closed.
   */
  severity: z.enum(["info", "important", "critical"]),
  title: z.string(),
});

type Notice = z.output<typeof NoticeSchema>;

export const NoticesResponseSchema = z.object({
  notices: z.array(z.unknown()),
  pollAfter: z.number().positive(),
});

/**
 * A notice as the bell shows it: whether the person has seen it yet, and, for
 * one the app makes itself, an action that opens a page in the app or a page
 * of Settings (lighting one row of it, by its setting name), and the
 * `account` kind, for an account that was signed out.
 */
export type BellNotice = Omit<Notice, "action" | "kind"> & {
  action?:
    | { href: string; label: string }
    | {
        label: string;
        setting?: string;
        settings: "Account" | "Permissions" | "Providers";
      }
    | Notice["action"];
  kind: Notice["kind"];
  seen: boolean;
};

/**
 * The accounts that sign in rather than take a key, by their provider type,
 * which is also the name of their row in Settings › Providers.
 */
export const SIGN_IN_ACCOUNT_NAMES = {
  "chatgpt-account": "ChatGPT",
  "claude-account": "Claude",
  "grok-account": "Grok",
} as const;

export type SignInAccountType = keyof typeof SIGN_IN_ACCOUNT_NAMES;

/** An account signed out without the person asking, by its connection id. */
export interface SignedOutAccount {
  /** When this was first seen, which the notice is dated and named by. */
  at: number;
  id: string;
  /** Which of several accounts of its type, when there is more than one. */
  label?: string;
  type: SignInAccountType;
}
