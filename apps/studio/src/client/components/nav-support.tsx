import { ExternalLink } from "@/client/components/external-link";
import { SUPPORT_URL } from "@instrument-org/shared";

export function NavSupport() {
  return (
    <div className="flex items-center gap-3 px-3 py-3 text-xs text-black/40 dark:text-white/40">
      <span>Private Beta</span>
      <ExternalLink
        className="transition-colors hover:text-black/60 dark:hover:text-white/60"
        href={SUPPORT_URL}
      >
        Feedback
      </ExternalLink>
    </div>
  );
}
