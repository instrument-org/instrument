import { type PlanProvider } from "@/client/hooks/use-connected-plans";

/**
 * The AI services whose site is an app and whose plan Instrument can run on,
 * by the directory slug of the app.
 */
const PLANS_BY_SERVICE: Record<string, PlanProvider> = {
  chatgpt: "chatgpt",
  claude: "claude",
  grok: "grok",
};

/** The plan an app's service sells, when it is one Instrument can run on. */
export function planOfApp(app: {
  service?: string | undefined;
  slug: string;
}): PlanProvider | undefined {
  const service = app.service ?? app.slug;
  return Object.hasOwn(PLANS_BY_SERVICE, service)
    ? PLANS_BY_SERVICE[service]
    : undefined;
}
