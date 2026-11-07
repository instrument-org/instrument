import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { Input } from "@/client/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/client/components/ui/tabs";
import { PROJECT_COLORS } from "@/client/components/window/project-colors";
import {
  PROJECT_ICON_GROUPS,
  type ProjectIcon,
  searchProjectIcons,
  suggestProjectIcons,
} from "@/client/components/window/project-icons";
import { projectTint } from "@/client/components/window/project-tint";
import { cn } from "@/client/lib/utils";
import { type ReactNode, useState } from "react";

import { EmojiGrid } from "./emoji-grid";

/**
 * The tints, one of them chosen: a pale one and a deep one of every hue, in
 * that order, so the two rows read as two families rather than as sixteen
 * neighbors. Each swatch is drawn in the rebuilt color rather than the raw hex,
 * since only the hue of a palette entry survives the tint and two entries that
 * look different here would otherwise come out the same on a mark.
 */
export function ColorRow({
  onPick,
  value,
}: {
  onPick: (color: string) => void;
  value?: string;
}) {
  return (
    // Eight to a row, each swatch taking an equal share of the width, so the
    // pale row sits square over the deep one and the two read as two families.
    <div className="grid grid-cols-8 justify-items-center gap-2">
      {PROJECT_COLORS.map((color) => (
        <button
          aria-label={`Color ${color}`}
          className={cn(
            "size-7 rounded-full transition project-tint",
            color === value
              ? // Outside the swatch, so choosing one does not shrink it: an
                // inset ring eats into the color it is meant to be marking.
                "ring-2 ring-foreground ring-offset-2 ring-offset-popover"
              : "ring-1 ring-black/10 ring-inset hover:scale-110",
          )}
          key={color}
          onClick={() => {
            onPick(color);
          }}
          style={{
            background: "var(--project-tint-base)",
            ...projectTint(color),
          }}
          type="button"
        />
      ))}
    </div>
  );
}

/**
 * The mark a project is known by, and the popover that changes it: an icon
 * from a curated set or any emoji, each with a search field and suggestions
 * for the name, so the mark that makes a project findable in a row of others
 * is chosen in one place. It opens on the kind of mark the project has.
 */
export function ProjectMarkPicker({
  children,
  context,
  icon,
  onEmoji,
  onIcon,
  onOpenChange,
  open,
}: {
  /** The trigger: the mark as it stands. */
  children: ReactNode;
  /** The name being marked, which the picker suggests icons and emoji for. */
  context?: string;
  /** The icon the project wears now, if it wears one. */
  icon?: string;
  onEmoji: (emoji: string) => void;
  onIcon: (icon: string) => void;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}) {
  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-76 p-0"
        side="bottom"
        sideOffset={6}
      >
        <Tabs className="gap-0" defaultValue={icon ? "icon" : "emoji"}>
          <div className="px-2 pt-2">
            <TabsList className="w-full">
              <TabsTrigger value="icon">Icon</TabsTrigger>
              <TabsTrigger value="emoji">Emoji</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="icon">
            <IconGrid
              context={context}
              onPick={(picked) => {
                onIcon(picked);
                onOpenChange?.(false);
              }}
              value={icon}
            />
          </TabsContent>
          <TabsContent value="emoji">
            <EmojiGrid
              context={context}
              onPick={(picked) => {
                onEmoji(picked);
                onOpenChange?.(false);
              }}
            />
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The curated icons, searchable by the words a person would guess. With no
 * query they sit in their groups under the ones that fit the name being
 * marked; a query replaces them with a flat list of matches.
 */
function IconGrid({
  context,
  onPick,
  value,
}: {
  context?: string;
  onPick: (icon: string) => void;
  value?: string;
}) {
  const [query, setQuery] = useState("");
  const words = query.trim();
  const about = context?.trim() ?? "";
  const suggested = suggestProjectIcons(about);
  const matches = words ? searchProjectIcons(words) : [];
  return (
    <div className="flex h-80 flex-col">
      <div className="p-2 pb-1">
        <Input
          autoFocus
          className="h-8"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Search icons"
          value={query}
        />
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {words ? (
          matches.length === 0 ? (
            <p className="px-1 pt-2 text-xs text-muted-foreground">
              No icons match “{words}”.
            </p>
          ) : (
            <div className="pt-2">
              <IconCells icons={matches} onPick={onPick} value={value} />
            </div>
          )
        ) : (
          <>
            {suggested.length > 0 && (
              <IconSection label={`Suggested for “${about}”`}>
                <IconCells icons={suggested} onPick={onPick} value={value} />
              </IconSection>
            )}
            {PROJECT_ICON_GROUPS.map((group) => (
              <IconSection key={group.label} label={group.label}>
                <IconCells icons={group.icons} onPick={onPick} value={value} />
              </IconSection>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function IconSection({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <section aria-label={label}>
      <h3 className="sticky top-0 z-10 truncate bg-popover px-1 pt-2 pb-1 text-xs font-medium text-muted-foreground">
        {label}
      </h3>
      {children}
    </section>
  );
}

function IconCells({
  icons,
  onPick,
  value,
}: {
  icons: readonly ProjectIcon[];
  onPick: (icon: string) => void;
  value?: string;
}) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {icons.map(({ Icon, name }) => (
        <button
          aria-label={name.replaceAll("-", " ")}
          aria-pressed={name === value}
          className={cn(
            "grid size-8 place-items-center rounded-md text-foreground/80 hover:bg-accent hover:text-foreground",
            name === value && "bg-accent text-foreground",
          )}
          key={name}
          onClick={() => {
            onPick(name);
          }}
          title={name.replaceAll("-", " ")}
          type="button"
        >
          <Icon className="size-5" weight="fill" />
        </button>
      ))}
    </div>
  );
}
