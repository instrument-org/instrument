import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import {
  AppChipIcon,
  INLINE_CHIP_CLASS_NAME,
} from "@/client/components/inline-link";
import { AppIcon } from "@/client/components/window/app-icon";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { type AppMention as AppMentionRef } from "@/client/lib/app-mention";
import { cn } from "@/client/lib/utils";

/** What a menu needs of an app to offer it and draw its row. */
export interface ComposerApp extends AppMentionRef {
  /** The installed app's own icon, for a local server that drives one. */
  icon?: string | undefined;
  /** The service's origin, for its icon. */
  site?: string | undefined;
}

/**
 * An app named in the composer: the same chip the transcript draws for a link
 * into the app, so what was written and what was sent read as one thing. The
 * icon and name come from the same lookup the transcript's chip uses, the
 * apps the workspace has and the directory's catalog, so an app named before
 * it is connected (a directory card's Connect) has its face in the draft too.
 * A slug neither knows wears the generic mark and the name the token carries.
 */
export function AppMention({ app }: { app: AppMentionRef }) {
  const known = useAppsBySlug().get(app.slug);
  return (
    <span
      className={cn(INLINE_CHIP_CLASS_NAME, "hover:bg-muted/50")}
      data-app={app.slug}
    >
      <AppChipIcon slug={app.slug} />
      <span className="truncate">{known?.name ?? app.name}</span>
    </span>
  );
}

/**
 * An app as the slash menu lays it out: its icon, its name with the matched
 * run marked, and what kind of thing it is at the right, where a skill says
 * where it came from.
 */
export function AppMenuRow({
  app,
  ranges,
}: {
  app: ComposerApp;
  ranges: null | number[];
}) {
  return (
    <>
      <AppIcon
        className="size-4! rounded-[3px]"
        name={app.name}
        icon={app.icon}
        site={app.site}
        size="sm"
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        <FuzzyHighlight ranges={ranges} text={app.name} />
      </span>
      <span className="shrink-0 text-xs text-muted-foreground/70">App</span>
    </>
  );
}
