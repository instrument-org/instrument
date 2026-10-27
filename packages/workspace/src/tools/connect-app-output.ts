import { z } from "zod";

/** What `connect_app` did about one app: put it on the card, found it connected, or could not ask. */
const ConnectAppResultSchema = z.discriminatedUnion("state", [
  z.object({
    /**
     * What the card asks for: a browser sign-in, a key, leave to run a
     * server on this machine, a sign-in on the service's own site, or
     * nothing.
     */
    kind: z.enum(["key", "none", "run", "sign-in", "web"]),
    name: z.string(),
    /** For a local app, what would run: the package, in words. */
    runs: z.string().optional(),
    /** The service's origin, for the card's icon. */
    site: z.string().optional(),
    slug: z.string(),
    state: z.literal("asked"),
    /** For a web app, the site the work happens on. */
    url: z.string().optional(),
  }),
  z.object({
    name: z.string(),
    slug: z.string(),
    state: z.literal("connected"),
  }),
  z.object({
    message: z.string(),
    slug: z.string(),
    state: z.literal("failure"),
  }),
]);

export type ConnectAppResult = z.output<typeof ConnectAppResultSchema>;

/**
 * A call's output: one result per app it named, in the order it named them.
 * A call recorded before one call could name several apps stored its one
 * app's result bare, which is read as a list of one (`connectAppResults`).
 */
export const ConnectAppOutputSchema = z.union([
  z.object({ apps: z.array(ConnectAppResultSchema).min(1) }),
  ConnectAppResultSchema,
]);

export type ConnectAppOutput = z.output<typeof ConnectAppOutputSchema>;

/** Every app a call's output names, whichever shape it was recorded in. */
export function connectAppResults(
  output: ConnectAppOutput,
): ConnectAppResult[] {
  return "apps" in output ? output.apps : [output];
}

/** An app with a row on a call's card: asked for, and needing something of the user. */
export type CardRow = Extract<ConnectAppResult, { state: "asked" }> & {
  kind: "key" | "run" | "sign-in" | "web";
};

/** The apps a call put on its card for the user to answer, in its order. */
export function askedOnCard(output: ConnectAppOutput): CardRow[] {
  return connectAppResults(output).flatMap((result) =>
    result.state === "asked" && result.kind !== "none"
      ? [{ ...result, kind: result.kind }]
      : [],
  );
}
