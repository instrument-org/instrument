import { z } from "zod";

/**
 * A notice from us, as `GET /notices` on the reports service sends it: a
 * build that can't update itself, a security fix, what's new, an
 * announcement, or a problem the person reported that's now fixed. Which
 * versions, platforms, channels and accounts one is for is the service's to
 * decide; none of that reaches the app.
 */
export const NoticeSchema = z.object({
  action: z.object({ label: z.string(), url: z.url() }).optional(),
  body: z.string(),
  endsAt: z.iso.datetime().optional(),
  id: z.string().min(1),
  kind: z.enum(["update", "whats-new", "announcement", "security", "fixed"]),
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
 * one the app makes itself, an action that opens a page in the app.
 */
export type BellNotice = Omit<Notice, "action"> & {
  action?: { href: string; label: string } | Notice["action"];
  seen: boolean;
};
