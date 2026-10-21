export const debugNavigationRoutes = [
  {
    id: "components",
    label: "Components",
    title: "Debug components",
    to: "/debug/components",
  },
  {
    id: "billing",
    label: "Billing",
    title: "Debug billing",
    to: "/debug/billing",
  },
] as const;

export const componentPages = [
  {
    id: "transcript",
    label: "Transcript",
    to: "/debug/components/transcript",
  },
  {
    id: "question",
    label: "Question card",
    to: "/debug/components/question",
  },
  {
    id: "error-card",
    label: "Error card",
    to: "/debug/components/error-card",
  },
  {
    id: "spinner",
    label: "Spinner",
    to: "/debug/components/spinner",
  },
  {
    id: "typography",
    label: "Typography",
    to: "/debug/components/typography",
  },
  {
    id: "colors",
    label: "Colors",
    to: "/debug/components/colors",
  },
  {
    id: "elevation",
    label: "Elevation",
    to: "/debug/components/elevation",
  },
  {
    id: "provider-icons",
    label: "Provider icons",
    to: "/debug/components/provider-icons",
  },
  {
    id: "app-icons",
    label: "App icons",
    to: "/debug/components/app-icons",
  },
  {
    id: "file-icons",
    label: "File icons",
    to: "/debug/components/file-icons",
  },
  {
    id: "alerts",
    label: "Alerts",
    to: "/debug/components/alerts",
  },
  {
    id: "toasts",
    label: "Toasts",
    to: "/debug/components/toasts",
  },
  {
    id: "form-elements",
    label: "Form elements",
    to: "/debug/components/form-elements",
  },
  {
    id: "model-notices",
    label: "Model notices",
    to: "/debug/components/model-notices",
  },
] as const;

type ComponentPageId = (typeof componentPages)[number]["id"];
type DebugRouteId = (typeof debugNavigationRoutes)[number]["id"];

/**
 * What a tab standing on a debug page is called, read off its path alone so
 * every place that names a tab from its address names this one too. A page
 * this file does not list is still "Debug", never an unnamed tab.
 */
export function debugPageTitle(pathname: string): string {
  const path = pathname.replace(/\/$/, "");
  const page = [...debugNavigationRoutes, ...componentPages].find((item) => item.to === path);
  return page?.label ?? "Debug";
}

export function getComponentPage(id: ComponentPageId) {
  const page = componentPages.find((item) => item.id === id);
  if (!page) {
    throw new Error(`Unknown component page: ${id}`);
  }
  return page;
}

export function getDebugRoute(id: DebugRouteId) {
  const route = debugNavigationRoutes.find((item) => item.id === id);
  if (!route) {
    throw new Error(`Unknown debug route: ${id}`);
  }
  return route;
}
