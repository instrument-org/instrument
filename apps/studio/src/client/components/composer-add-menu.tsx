import { type ComposerApp } from "@/client/components/app-mention";
import {
  type ComposerSkill,
  SkillMenuRow,
} from "@/client/components/skill-menu-row";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { MenuScrollArea } from "@/client/components/ui/menu-scroll-area";
import { useComposerMenuPlacement } from "@/client/hooks/use-composer-menu-placement";
import { cn } from "@/client/lib/utils";
import { type Icon } from "@phosphor-icons/react";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { DesktopIcon } from "@phosphor-icons/react/Desktop";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { GraduationCapIcon } from "@phosphor-icons/react/GraduationCap";
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { SquaresFourIcon } from "@phosphor-icons/react/SquaresFour";
import { useRef } from "react";

import { AppIcon } from "./window/app-icon";

/**
 * Something the composer can be given, offered by name in the menu that adds
 * it. The same list answers the plus button and a typed slash, so an entry is
 * described once and its `onSelect` is what differs per surface.
 */
export interface ComposerAction {
  /**
   * For an entry that opens another surface in this menu's place. It runs once
   * the menu has closed rather than on the click: a popover opened while the
   * menu is still tearing down loses the caret to it -- a menu takes focus back
   * to its own content as the pointer leaves an item, and a layer that sees
   * focus land outside itself dismisses. The caret is then the new surface's,
   * so the prompt does not take it back either.
   */
  handsOff?: boolean;
  icon: Icon;
  id: string;
  /**
   * For an entry that turns the menu into something else rather than acting and
   * leaving. Ignored by surfaces that were never a menu to begin with.
   */
  keepMenuOpen?: boolean;
  label: string;
  onSelect: () => void;
}

/**
 * Which face the menu is wearing, or `null` for closed. A list replaces the
 * menu rather than opening a second one beside it, and the caller owns this.
 */
export type ComposerMenuView = "apps" | "root" | "skills";

/**
 * What a chat's plus opens beside the chat, where the composer is a chat's:
 * the web's starting view, the computer, and the apps to name in the words.
 * Given these, the menu leads with them as rows and keeps the apps and the
 * skills behind rows of their own.
 */
export interface ComposerPlaces {
  apps: ComposerApp[];
  /** What this computer is called on its tile. */
  computerName: string;
  /** Names an app in the words, as a mention. */
  onNameApp: (app: ComposerApp) => void;
  /** Takes the window to Apps, where another app is connected. */
  onOpenApps: () => void;
  onOpenComputer: () => void;
  onOpenWeb: () => void;
}

/** The actions a chat's plus draws as its two attach buttons rather than as rows. */
const ATTACH_ACTIONS = new Set(["add-files", "work-in-folder"]);

/**
 * The plus button and everything it offers: what the composer can be given,
 * then the skills that can be run.
 *
 * Sized and placed to the composer rather than to its own trigger. The skills
 * read as a line of name, description and source -- the width a typed slash
 * gives them -- and the prompt this is adding to stays in view beside the menu
 * rather than under it.
 */
export function ComposerAddMenu({
  actions,
  bounds,
  disabled,
  label,
  onReturnFocus,
  onSelectSkill,
  onViewChange,
  places,
  skills,
  triggerClassName,
  view,
}: {
  actions: ComposerAction[];
  /** The composer box this hangs off, rather than overlays. */
  bounds: HTMLElement | null;
  disabled?: boolean;
  /** A word on the trigger beside its mark, where a bare plus would not say what it is for. */
  label?: string;
  /** Puts the caret back in the prompt, once something has been chosen here. */
  onReturnFocus: () => void;
  onSelectSkill: (skill: ComposerSkill) => void;
  onViewChange: (view: ComposerMenuView | null) => void;
  /** A chat's places, which turn the menu into tiles over its rows. */
  places?: ComposerPlaces;
  skills: ComposerSkill[];
  /** The trigger's shape where the composer draws it differently: a pill's round button. */
  triggerClassName?: string;
  view: ComposerMenuView | null;
}) {
  // Whether this closed because something was chosen, which is the only case
  // where the menu owns where focus lands next. Dismissing it is the user
  // going somewhere themselves, and Radix's own handling is right for that.
  const chose = useRef<"hand-off" | "prompt" | null>(null);
  // A hand-off's own work, held until this menu is gone rather than run where
  // it was chosen. See `handsOff`.
  const handOff = useRef<(() => void) | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // An entry acting and leaving, turning the menu into something else, or
  // handing off to a surface that opens once the menu has gone.
  const choose = (action: ComposerAction, event: Event) => {
    if (action.keepMenuOpen) {
      event.preventDefault();
      action.onSelect();
      return;
    }
    if (action.handsOff) {
      chose.current = "hand-off";
      handOff.current = action.onSelect;
      return;
    }
    chose.current = "prompt";
    action.onSelect();
  };
  const { alignOffset, side, sideOffset, width } = useComposerMenuPlacement({
    anchorRef: triggerRef,
    bounds,
    open: view !== null,
  });

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        onViewChange(open ? "root" : null);
      }}
      open={view !== null}
    >
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={label ?? "Add to this prompt"}
          // A filled rest state rather than a ghost one, so the way in is
          // visible before it is pointed at. Its hover has to darken in one
          // theme and lighten in the other, which no single token does.
          className={cn(
            "bg-muted text-foreground/60 not-disabled:hover:bg-black/10 dark:not-disabled:hover:bg-white/15",
            label === undefined ? "size-8 p-0" : "h-7 gap-1 px-2 text-xs",
            triggerClassName,
          )}
          disabled={disabled}
          ref={triggerRef}
          size="sm"
          variant="ghost"
        >
          {label === undefined ? (
            <PlusIcon className="size-5" weight="regular" />
          ) : (
            <>
              <PaperclipIcon className="size-4" />
              {label}
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        alignOffset={alignOffset}
        avoidCollisions={false}
        // Room for the first group and a few skills, and no more: left to the
        // available height a full skills list becomes a column as tall as the
        // window. The same cap the slash menu keeps, over the same entries.
        //
        // The corner is the composer's own rather than the menu radius every
        // other dropdown wears, since this one is read against the edge of the
        // box it hangs off.
        className="flex max-h-[min(18rem,calc(var(--radix-dropdown-menu-content-available-height)/var(--content-zoom)))] flex-col rounded-[20px] p-0"
        // Everything on offer here is something the prompt is about to carry,
        // so the caret goes back to the prompt rather than to the button that
        // opened this -- including out of a list, which is a second menu deep
        // and would otherwise leave the caret nowhere.
        onCloseAutoFocus={(event) => {
          const after = chose.current;
          const opensNext = handOff.current;
          chose.current = null;
          handOff.current = null;
          if (!after) {
            return;
          }
          event.preventDefault();
          if (after === "prompt") {
            onReturnFocus();
          }
          // Radix fires this from the teardown of the layer itself, so by here
          // the menu is gone and the surface this hands off to is the only one
          // on screen.
          opensNext?.();
        }}
        side={side}
        sideOffset={sideOffset}
        // A chat's menu is a list of rows, sized to them rather than to the
        // box it hangs off, which would stretch a row across a wide window.
        style={places ? { width: "16rem" } : { width }}
      >
        <MenuScrollArea>
          {view === "apps" && places ? (
            <>
              <BackItem
                label="Apps"
                onBack={() => {
                  onViewChange("root");
                }}
              />
              {places.apps.map((app) => (
                <DropdownMenuItem
                  key={app.slug}
                  onSelect={() => {
                    chose.current = "prompt";
                    places.onNameApp(app);
                  }}
                >
                  <AppIcon
                    name={app.name}
                    icon={app.icon}
                    site={app.site}
                    size="sm"
                  />
                  {app.name}
                </DropdownMenuItem>
              ))}
              {places.apps.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onSelect={() => {
                  places.onOpenApps();
                }}
              >
                <PlusIcon className="size-4" />
                Connect an app…
              </DropdownMenuItem>
            </>
          ) : view === "skills" && places ? (
            <>
              <BackItem
                label="Skills"
                onBack={() => {
                  onViewChange("root");
                }}
              />
              {skills.map((skill) => (
                <SkillItem
                  key={skill.id}
                  onSelect={() => {
                    chose.current = "prompt";
                    onSelectSkill(skill);
                  }}
                  skill={skill}
                />
              ))}
            </>
          ) : places ? (
            // One list, the way the rest of the menu reads, so every entry
            // is reached by the keyboard: where to look, what to attach, then
            // the apps and skills to name in the words and the rest.
            <>
              {/* What opens takes the caret, so it opens once the menu has
                  gone rather than as the menu hands focus back. */}
              <DropdownMenuItem
                onSelect={() => {
                  chose.current = "hand-off";
                  handOff.current = places.onOpenWeb;
                }}
              >
                <GlobeIcon className="size-4" />
                Browser
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  chose.current = "hand-off";
                  handOff.current = places.onOpenComputer;
                }}
              >
                <DesktopIcon className="size-4" />
                {places.computerName}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {actions
                .filter((action) => ATTACH_ACTIONS.has(action.id))
                .map((action) => (
                  <ActionItem
                    action={action}
                    key={action.id}
                    onSelect={(event) => {
                      choose(action, event);
                    }}
                  />
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  onViewChange("apps");
                }}
              >
                <SquaresFourIcon className="size-4" />
                <span className="min-w-0 flex-1">Apps</span>
                <CaretRightIcon className="size-3.5 text-muted-foreground" />
              </DropdownMenuItem>
              {skills.length > 0 && (
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    onViewChange("skills");
                  }}
                >
                  <GraduationCapIcon className="size-4" />
                  <span className="min-w-0 flex-1">Skill</span>
                  <CaretRightIcon className="size-3.5 text-muted-foreground" />
                </DropdownMenuItem>
              )}
              {actions
                .filter((action) => !ATTACH_ACTIONS.has(action.id))
                .map((action) => (
                  <ActionItem
                    action={action}
                    key={action.id}
                    onSelect={(event) => {
                      choose(action, event);
                    }}
                  />
                ))}
            </>
          ) : (
            <>
              {actions.map((action) => (
                <ActionItem
                  action={action}
                  key={action.id}
                  onSelect={(event) => {
                    choose(action, event);
                  }}
                />
              ))}
              {skills.length > 0 && (
                <MenuGroupHeader keyHint="/" label="Skills" />
              )}
              {skills.map((skill) => (
                <SkillItem
                  key={skill.id}
                  onSelect={() => {
                    chose.current = "prompt";
                    onSelectSkill(skill);
                  }}
                  skill={skill}
                />
              ))}
            </>
          )}
        </MenuScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Names a run of items, and says which key reaches them without the menu. The
 * rule above it is what separates the groups, so the first one carries none.
 */
export function MenuGroupHeader({
  className,
  keyHint,
  label,
}: {
  className?: string;
  keyHint?: string;
  label: string;
}) {
  return (
    <div
      className={cn(
        "-mx-1 mt-1 flex items-center gap-2 border-t border-black/5 px-4 pt-2 pb-1 text-xs text-muted-foreground dark:border-white/5",
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {keyHint && (
        <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted font-semibold">
          {keyHint}
        </span>
      )}
    </div>
  );
}

/** One of the menu's own entries, whose choosing the menu handles. */
function ActionItem({
  action,
  onSelect,
}: {
  action: ComposerAction;
  onSelect: (event: Event) => void;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect}>
      <action.icon className="size-4" />
      {action.label}
    </DropdownMenuItem>
  );
}

/** The first row of a menu turned into a list: its name, and the way back to the menu. */
function BackItem({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <DropdownMenuItem
      className="text-muted-foreground"
      onSelect={(event) => {
        event.preventDefault();
        onBack();
      }}
    >
      <ArrowLeftIcon className="size-4" />
      {label}
    </DropdownMenuItem>
  );
}

function SkillItem({
  onSelect,
  skill,
}: {
  onSelect: () => void;
  skill: ComposerSkill;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect}>
      <SkillMenuRow
        match={{
          descriptionRanges: null,
          nameRanges: null,
          skill,
        }}
      />
    </DropdownMenuItem>
  );
}
