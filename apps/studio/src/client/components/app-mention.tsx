import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import {
  INLINE_CHIP_CLASS_NAME,
  INLINE_CHIP_ICON_CLASS_NAME,
} from "@/client/components/inline-link";
import { AppIcon } from "@/client/components/orchestrator/app-icon";
import { type AppMention as AppMentionRef } from "@/client/lib/app-mention";
import { cn } from "@/client/lib/utils";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";

/** What a menu needs of an app to offer it, and what its chip draws it with. */
export interface ComposerApp extends AppMentionRef {
  /** The service's origin, for its icon. */
  site?: string | undefined;
}

/**
 * An app named in the composer: the same chip the transcript draws for a link
 * into the app, so what was written and what was sent read as one thing. The
 * icon is the app's own where the window knows the app; a slug it does not
 * know wears the generic mark and the name the token carries.
 */
export function AppMention({
  app,
  apps,
}: {
  app: AppMentionRef;
  /** The apps the window has, for the icon; the token itself carries only the name. */
  apps: ComposerApp[];
}) {
  const known = apps.find((entry) => entry.slug === app.slug);
  return (
    <span
      className={cn(INLINE_CHIP_CLASS_NAME, "hover:bg-muted/50")}
      data-app={app.slug}
    >
      {/* Any app the window knows gets its face, a site's icon or its own
          initial, the way the transcript's chip draws it; only a name the
          window has no app for gets the generic mark. */}
      {known ? (
        <AppIcon
          className="size-3! rounded-xs"
          name={known.name}
          site={known.site}
          size="sm"
        />
      ) : (
        <AppWindowIcon className={INLINE_CHIP_ICON_CLASS_NAME} />
      )}
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
