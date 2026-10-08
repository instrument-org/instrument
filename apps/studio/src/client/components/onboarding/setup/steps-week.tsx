import { SetupWell } from "@/client/components/onboarding/setup/steps-art";
import {
  WORK_KINDS,
  type WorkKindId,
} from "@/client/components/onboarding/setup/tasks-starters";
import { cn } from "@/client/lib/utils";
import { AirplaneTiltIcon } from "@phosphor-icons/react/AirplaneTilt";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { ClipboardTextIcon } from "@phosphor-icons/react/ClipboardText";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { CoinsIcon } from "@phosphor-icons/react/Coins";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { GraduationCapIcon } from "@phosphor-icons/react/GraduationCap";
import { HandshakeIcon } from "@phosphor-icons/react/Handshake";
import { HouseIcon } from "@phosphor-icons/react/House";
import { KanbanIcon } from "@phosphor-icons/react/Kanban";
import { MegaphoneIcon } from "@phosphor-icons/react/Megaphone";
import { PaletteIcon } from "@phosphor-icons/react/Palette";
import { PenNibIcon } from "@phosphor-icons/react/PenNib";
import { PencilSimpleLineIcon } from "@phosphor-icons/react/PencilSimpleLine";
import { StorefrontIcon } from "@phosphor-icons/react/Storefront";
import { type ComponentType } from "react";

/** Each kind of work's glyph and hue on "What fills your week?". */
const WORK_LOOKS: Record<
  WorkKindId,
  { hue: string; Icon: ComponentType<{ className?: string }> }
> = {
  admin: { hue: "#64748b", Icon: ClipboardTextIcon },
  business: { hue: "#ea8a2e", Icon: StorefrontIcon },
  coding: { hue: "#0f766e", Icon: CodeIcon },
  design: { hue: "#e25b4b", Icon: PaletteIcon },
  home: { hue: "#a46b2c", Icon: HouseIcon },
  marketing: { hue: "#e0507f", Icon: MegaphoneIcon },
  money: { hue: "#16a34a", Icon: CoinsIcon },
  projects: { hue: "#7c5cd6", Icon: KanbanIcon },
  sales: { hue: "#3b82f6", Icon: HandshakeIcon },
  school: { hue: "#0f9f95", Icon: GraduationCapIcon },
  travel: { hue: "#0ea5e9", Icon: AirplaneTiltIcon },
  writing: { hue: "#5b6bd6", Icon: PenNibIcon },
};

const SOMETHING_ELSE_HUE = "#78716c";

/**
 * The twelve kinds of work and Something else, which opens into a field
 * across the grid for whatever the chips missed. Picks are kept by id.
 */
export function WeekGrid({
  isOtherOpen,
  onOpenOther,
  onOtherChange,
  onToggle,
  other,
  picked,
}: {
  isOtherOpen: boolean;
  onOpenOther: (open: boolean) => void;
  onOtherChange: (text: string) => void;
  onToggle: (id: WorkKindId) => void;
  other: string;
  picked: readonly string[];
}) {
  return (
    <div className="mt-7 grid w-190 grid-cols-3 gap-3">
      {WORK_KINDS.map((kind) => {
        const { hue, Icon } = WORK_LOOKS[kind.id];
        const isPicked = picked.includes(kind.id);
        return (
          <button
            aria-pressed={isPicked}
            className={cn(
              "flex items-center gap-3 rounded-2xl bg-card px-3 py-2.5 text-left text-sm font-medium text-foreground shadow-xs transition-shadow",
              isPicked
                ? "ring-2 ring-brand-500"
                : "ring-1 ring-black/[0.07] hover:ring-black/15 dark:ring-white/10",
            )}
            key={kind.id}
            onClick={() => {
              onToggle(kind.id);
            }}
            type="button"
          >
            <SetupWell hue={hue}>
              <Icon />
            </SetupWell>
            <span className="flex-1">{kind.label}</span>
            {isPicked && (
              <CheckCircleIcon
                className="size-4.5 text-brand-600"
                weight="fill"
              />
            )}
          </button>
        );
      })}
      {isOtherOpen ? (
        <label className="col-span-3 flex items-center gap-3 rounded-2xl bg-card px-3 py-2.5 shadow-xs ring-2 ring-brand-500">
          <SetupWell hue={SOMETHING_ELSE_HUE}>
            <PencilSimpleLineIcon />
          </SetupWell>
          <input
            aria-label="Something else"
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/40"
            onBlur={() => {
              if (!other.trim()) {
                onOpenOther(false);
              }
            }}
            onChange={(event) => {
              onOtherChange(event.target.value);
            }}
            placeholder="Tell us what fills your week"
            value={other}
          />
        </label>
      ) : (
        <button
          className="col-start-2 flex items-center gap-3 rounded-2xl bg-card px-3 py-2.5 text-left text-sm font-medium text-foreground shadow-xs ring-1 ring-black/[0.07] hover:ring-black/15 dark:ring-white/10"
          onClick={() => {
            onOpenOther(true);
          }}
          type="button"
        >
          <SetupWell hue={SOMETHING_ELSE_HUE}>
            <DotsThreeIcon weight="bold" />
          </SetupWell>
          <span className="flex-1">Something else</span>
        </button>
      )}
    </div>
  );
}
