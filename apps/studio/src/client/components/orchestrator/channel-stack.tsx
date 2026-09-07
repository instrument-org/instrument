import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** A channel as the stack draws it: what it is called and what it wants. */
export interface Channel {
  id: string;
  name: string;
  /** Agent messages since the user last had it on screen. */
  unread: number;
  /** A task filed from this channel is working. */
  working?: boolean;
}

/**
 * The channel a task came from, wherever a task is named away from the stack.
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

/** What every row in the stack measures, open or closed. */
const ROW = "mx-3 flex h-8 shrink-0 items-center gap-1.5 px-2 text-[13px]";

/** Where a dragged channel would land, drawn on the row it would land against. */
const DROP_ABOVE = "shadow-[inset_0_2px_0_0_var(--primary)]";
const DROP_BELOW = "shadow-[inset_0_-2px_0_0_var(--primary)]";

/**
 * The channels, as a stack the conversation opens inside.
 *
 * Every channel is a row carrying its whole name, and the one you are in
 * expands in place: the rows above it stay above, the rows below stay below,
 * and the composer lands where that channel ends. Nothing truncates and
 * nothing hides behind a picker, so how many channels a person can hold is set
 * by the sidebar's height rather than by how many names fit across its width.
 */
export function ChannelStack({
  channels,
  children,
  firstId,
  onArchive,
  onNew,
  onRename,
  onReorder,
  onSelect,
  selectedId,
}: {
  channels: Channel[];
  /** The conversation, drawn inside whichever channel is open. */
  children: ReactNode;
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
  const [naming, setNaming] = useState<{ id?: string }>();
  // A channel being carried, and the row it would land against.
  const [drag, setDrag] = useState<{
    after: boolean;
    id: string;
    over: string;
  }>();

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

  const menuChannel = channels.find((channel) => channel.id === menu?.key);

  const openMenu = (key: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    setMenu({ key, x: event.clientX, y: event.clientY });
  };

  // The row a drag is over decides where the carried channel lands: before it
  // or after it, by which half of the row the pointer is in.
  const dragOver = (id: string) => (event: React.DragEvent) => {
    if (!drag || drag.id === id) {
      return;
    }
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    if (drag.over !== id || drag.after !== after) {
      setDrag({ after, id: drag.id, over: id });
    }
  };
  const drop = (event: React.DragEvent) => {
    event.preventDefault();
    if (drag && drag.id !== drag.over) {
      const ids = channels
        .map((channel) => channel.id)
        .filter((id) => id !== drag.id);
      const at = ids.indexOf(drag.over) + (drag.after ? 1 : 0);
      ids.splice(at, 0, drag.id);
      onReorder(ids);
    }
    setDrag(undefined);
  };
  const dropMark = (id: string) =>
    drag?.over === id ? (drag.after ? DROP_BELOW : DROP_ABOVE) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-6 shrink-0 items-center gap-1 px-5">
        <p className="min-w-0 flex-1 text-[11px] font-medium tracking-wide text-muted-foreground/60 uppercase">
          Channels
        </p>
        <button
          aria-label="New channel"
          className="-mr-1 grid size-5 place-items-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={() => {
            setNaming({});
          }}
          type="button"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {channels.map((channel) => {
          if (naming?.id === channel.id) {
            return (
              <NameField
                defaultValue={channel.name}
                key={channel.id}
                onCancel={() => {
                  setNaming(undefined);
                }}
                onCommit={(name) => {
                  setNaming(undefined);
                  onRename(channel.id, name);
                }}
              />
            );
          }
          if (channel.id === selectedId) {
            return (
              <div
                className="flex min-h-64 flex-1 flex-col"
                key={channel.id}
                onDragOver={dragOver(channel.id)}
                onDrop={drop}
              >
                <div
                  className={cn(ROW, "font-medium", dropMark(channel.id))}
                  onContextMenu={openMenu(channel.id)}
                >
                  <CaretDownIcon className="size-3 shrink-0 text-muted-foreground" />
                  <ChannelMark />
                  <span className="min-w-0 flex-1 truncate">
                    {channel.name}
                  </span>
                </div>
                <div className="flex min-h-0 flex-1 flex-col">{children}</div>
              </div>
            );
          }
          return (
            <button
              className={cn(
                ROW,
                "rounded-md text-left text-muted-foreground hover:bg-foreground/5",
                drag?.id === channel.id && "opacity-40",
                dropMark(channel.id),
              )}
              draggable
              key={channel.id}
              onClick={() => {
                onSelect(channel.id);
              }}
              onContextMenu={openMenu(channel.id)}
              onDragEnd={() => {
                setDrag(undefined);
              }}
              onDragOver={dragOver(channel.id)}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                setDrag({ after: false, id: channel.id, over: channel.id });
              }}
              onDrop={drop}
              type="button"
            >
              <CaretRightIcon className="size-3 shrink-0 text-muted-foreground/70" />
              <ChannelMark className="text-muted-foreground/70" />
              <span className="min-w-0 flex-1 truncate">{channel.name}</span>
              {channel.working ? (
                <span className="size-1.5 shrink-0 rounded-full bg-primary" />
              ) : null}
              {channel.unread > 0 ? (
                <span className="shrink-0 rounded-full bg-foreground px-1 text-[10px] leading-4 font-medium text-background">
                  {channel.unread}
                </span>
              ) : null}
            </button>
          );
        })}
        {naming && !naming.id ? (
          <NameField
            defaultValue=""
            onCancel={() => {
              setNaming(undefined);
            }}
            onCommit={(name) => {
              setNaming(undefined);
              onNew(name);
            }}
          />
        ) : null}
      </div>
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
              setNaming({ id: menuChannel.id });
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
    </div>
  );
}

/**
 * The field a channel is named in: the row it will live on, in edit. Focused
 * and selected on mount, so renaming starts on the old name and a new channel
 * starts empty.
 */
function NameField({
  defaultValue,
  onCancel,
  onCommit,
}: {
  defaultValue: string;
  onCancel: () => void;
  onCommit: (name: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.select();
  }, []);
  return (
    <div className={ROW}>
      <ChannelMark className="text-muted-foreground/70" />
      <input
        className="h-6 min-w-0 flex-1 rounded-md bg-card px-1.5 text-[13px] text-foreground ring-1 ring-border outline-hidden focus:ring-ring"
        defaultValue={defaultValue}
        maxLength={16}
        onBlur={onCancel}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onCancel();
            return;
          }
          if (event.key !== "Enter") {
            return;
          }
          const name = event.currentTarget.value.trim();
          if (name) {
            onCommit(name);
          } else {
            onCancel();
          }
        }}
        placeholder="Name it"
        ref={inputRef}
      />
    </div>
  );
}
