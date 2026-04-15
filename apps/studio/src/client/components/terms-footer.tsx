import { ExternalLink } from "@/client/components/external-link";
import { APP_URL } from "@instrument-org/shared";

export function TermsFooter({ className }: { className?: string }) {
  return (
    <p className={className}>
      By clicking continue, you agree to our{" "}
      <ExternalLink className="underline" href={`${APP_URL}/terms`}>
        Terms of Service
      </ExternalLink>{" "}
      and{" "}
      <ExternalLink className="underline" href={`${APP_URL}/privacy`}>
        Privacy Policy
      </ExternalLink>
      .
    </p>
  );
}
