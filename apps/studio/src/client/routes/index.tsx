import { type StudioPath } from "@/shared/studio-path";
import { createFileRoute, redirect } from "@tanstack/react-router";

const windowTypeRedirects = {
  onboarding: "/onboarding",
  shell: "/shell",
} as const satisfies Record<
  NonNullable<Window["api"]["windowType"]>,
  StudioPath
>;

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    const windowType = window.api.windowType;
    const to = windowType ? windowTypeRedirects[windowType] : "/new-tab";
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to });
  },
  component: RouteComponent,
});

function RouteComponent() {
  return null;
}
