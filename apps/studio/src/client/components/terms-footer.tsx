import { ExternalLink } from "@/client/components/external-link";
import { cn } from "@/client/lib/utils";
import { APP_URL } from "@instrument-org/shared";

export function TermsFooter({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "text-center text-xs text-balance text-foreground/40 [&_a]:underline [&_a]:underline-offset-4",
        className,
      )}
    >
      By continuing, you agree to our{" "}
      <ExternalLink href={`${APP_URL}/terms`}>Terms of Service</ExternalLink>{" "}
      and{" "}
      <ExternalLink href={`${APP_URL}/privacy`}>Privacy Policy</ExternalLink>.
    </p>
  );
}
