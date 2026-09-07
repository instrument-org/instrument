import { TabStrip } from "@/client/components/orchestrator/tab-strip";
import { cn } from "@/client/lib/utils";
import { useEffect, useRef, useState } from "react";

/** A channel as the strip draws it: what it is called and what it wants. */
export interface ChannelTab {
  id: string;
  name: string;
  /** Agent messages since the user last had it on screen. */
  unread: number;
  /** A task filed from this channel is working. */
  working?: boolean;
}

/**
 * The channel a task came from, wherever a task is named away from the strip.
 * A hash rather than a letter or a color: the name is the identity, and the
 * mark is only there so the eye can find where the name starts.
 */
export function ChannelMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 text-[13px] leading-none text-muted-foreground",
        className,
      )}
    >
      #
    </span>
  );
}

/**
 * The channels, as the first row of the conversation.
 *
 * Drawn with the strip the browser and This Mac use, so a channel behaves like
 * every other tab in the window: an even share of the row, compression rather
 * than a scroll, dragged to reorder, and a menu on right click. The tab
 * carries its own signal, since nothing else in the sidebar says what moved or
 * what is running.
 */
export function ChannelStrip({
  channels,
  firstId,
  onArchive,
  onNew,
  onRename,
  onReorder,
  onSelect,
  selectedId,
}: {
  channels: ChannelTab[];
  /** The channel that stays: the one the conversation started in. */
  firstId?: string;
  onArchive: (id: string) => void;
  onNew: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onReorder: (ids: string[]) => void;
  onSelect: (id: string) => void;
  selectedId?: string;
}) {
  const [menu, setMenu] = useState<{ key: string; x: number; y: number }>();
  const [naming, setNaming] = useState<{ id?: string; value: string }>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const close = () => {
      setMenu(undefined);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  useEffect(() => {
    inputRef.current?.select();
  }, [naming?.id]);

  const menuChannel = channels.find((channel) => channel.id === menu?.key);

  if (naming) {
    return (
      <div className="flex h-9 shrink-0 items-center gap-2 px-2">
        <ChannelMark />
        <input
          className="h-7 min-w-0 flex-1 rounded-md bg-card px-2 text-[13px] text-foreground ring-1 ring-border outline-hidden focus:ring-ring"
          maxLength={16}
          onBlur={() => {
            setNaming(undefined);
          }}
          onChange={(event) => {
            setNaming({ ...naming, value: event.target.value });
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setNaming(undefined);
              return;
            }
            if (event.key !== "Enter") {
              return;
            }
            const name = naming.value.trim();
            const { id } = naming;
            setNaming(undefined);
            if (!name) {
              return;
            }
            if (id) {
              onRename(id, name);
            } else {
              onNew(name);
            }
          }}
          placeholder="Channel name"
          ref={inputRef}
          value={naming.value}
        />
      </div>
    );
  }

  return (
    <>
      <TabStrip
        className="h-9 px-2"
        onClose={(key) => {
          if (key !== firstId && channels.length > 1) {
            onArchive(key);
          }
        }}
        onContextMenu={(key, event) => {
          event.preventDefault();
          setMenu({ key, x: event.clientX, y: event.clientY });
        }}
        onNew={() => {
          setNaming({ value: "" });
        }}
        onReorder={onReorder}
        onSelect={onSelect}
        selectedKey={selectedId}
        tabs={channels.map((channel) => ({
          icon: <ChannelMark />,
          isWorking: channel.working ?? false,
          key: channel.id,
          title: channel.name,
          ...(channel.unread > 0
            ? {
                badge: (
                  <span className="shrink-0 rounded-full bg-foreground px-1 text-[10px] leading-4 font-medium text-background">
                    {channel.unread}
                  </span>
                ),
              }
            : {}),
        }))}
      />
      {menu && menuChannel && (
        <div
          className="fixed z-50 min-w-40 rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          role="menu"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            className="flex w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent"
            onClick={() => {
              setNaming({ id: menuChannel.id, value: menuChannel.name });
              setMenu(undefined);
            }}
            role="menuitem"
            type="button"
          >
            Rename
          </button>
          <button
            className="flex w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent disabled:opacity-40"
            disabled={menuChannel.id === firstId || channels.length <= 1}
            onClick={() => {
              onArchive(menuChannel.id);
              setMenu(undefined);
            }}
            role="menuitem"
            type="button"
          >
            Archive
          </button>
        </div>
      )}
    </>
  );
}
