import { ExternalLink } from "@/client/components/external-link";
import { NEW_ISSUE_URL, SUPPORT_URL } from "@instrument-org/shared";

export function NavSupport() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 text-xs text-black/40 dark:text-white/40">
      <span>Private Beta</span>
      <ExternalLink
        className="hover:text-black/60 dark:hover:text-white/60"
        href={SUPPORT_URL}
      >
        Feedback
      </ExternalLink>
      <ExternalLink
        className="hover:text-black/60 dark:hover:text-white/60"
        href={NEW_ISSUE_URL}
      >
        Report a Bug
      </ExternalLink>
    </div>
  );
}
