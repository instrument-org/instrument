import { AppIconStylized } from "@/client/components/app-icon-stylized";
import { TermsFooter } from "@/client/components/terms-footer";
import { Button } from "@/client/components/ui/button";
import { createIconMeta } from "@/shared/tabs";
import { APP_NAME } from "@instrument-org/shared";
import { createFileRoute } from "@tanstack/react-router";
import { FcGoogle } from "react-icons/fc";

export const Route = createFileRoute("/_app/_not_authenticated/welcome2")({
  component: RouteComponent,
  head: () => {
    return {
      meta: [{ title: `Welcome to ${APP_NAME}` }, createIconMeta("our-app")],
    };
  },
});

function RouteComponent() {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-between overflow-hidden px-6 py-6 [background:radial-gradient(ellipse_80%_55%_at_50%_-5%,var(--brand-300)_0%,var(--brand-25)_65%,var(--brown-25)_100%)] dark:[background:var(--background)]">
      <div className="pointer-events-none absolute inset-0 hidden opacity-[0.04] [background:linear-gradient(180deg,var(--brand-600)_0%,transparent_100%)] dark:block" />
      <div className="flex-1" />

      <div className="relative z-10 flex flex-col items-center gap-11">
        <div className="flex flex-col items-center gap-9">
          <AppIconStylized className="size-20" />

          <div className="flex flex-col items-center gap-3 text-center">
            <h1 className="font-serif text-5xl font-medium tracking-tight text-foreground">
              Sign in to {APP_NAME}
            </h1>
            <p className="text-lg text-foreground/80">
              A guided AI workspace for ambitious work
            </p>
          </div>
        </div>

        <div className="flex w-full max-w-sm flex-col gap-3">
          <Button
            className="w-full justify-center bg-white text-secondary-foreground shadow-sm hover:bg-white/90 dark:bg-white dark:text-neutral-900 dark:hover:bg-white/90"
            type="button"
            variant="outline"
          >
            <FcGoogle className="size-4" />
            Continue with Google
          </Button>

          <Button
            className="w-full justify-center bg-white/30 text-foreground/60 hover:bg-white/40 dark:bg-white/5 dark:hover:bg-white/10"
            type="button"
            variant="ghost"
          >
            Or add an AI provider manually
          </Button>
        </div>
      </div>

      <div className="flex-1" />

      <TermsFooter />
    </div>
  );
}
