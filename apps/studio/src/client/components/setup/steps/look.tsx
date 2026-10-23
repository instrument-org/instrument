import { BrandMark } from "@/client/components/brand-mark";
import { useTheme } from "@/client/components/theme-provider";
import { Button } from "@/client/components/ui/button";
import { useLiveUser } from "@/client/hooks/use-live-user";
import { applyThemeClass } from "@/client/lib/initial-theme";
import { cn } from "@/client/lib/utils";
import { APP_NAME } from "@instrument-org/shared";
import { useReducedMotion } from "motion/react";
import { useState } from "react";

import { SetupFooter, SetupPage } from "../kit/setup-page";
import { SetupPageSwitch } from "../kit/setup-page-switch";
import { type SetupStepProps } from "../step-props";

type ThemeOption = "dark" | "light" | "system";

const THEMES: { label: string; value: ThemeOption }[] = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
  { label: "System", value: "system" },
];

/**
 * The look (frame 14), then All set (15). Picking a theme shows it at once;
 * Continue leads to All set, whose button finishes setup, so the step is
 * answered only by finishing and a quit at All set comes back here.
 */
export function LookStep({
  isLast,
  onBack,
  onContinue,
  onFinish,
}: SetupStepProps) {
  const { setTheme, theme } = useTheme();
  const [isAllSet, setIsAllSet] = useState(false);
  const isReduced = useReducedMotion() ?? false;
  // The pick shows at once, cross-fading from the theme before unless motion
  // is reduced; the preference lands after and applies the same class.
  const pick = (value: ThemeOption) => {
    const show = () => {
      applyThemeClass(value);
    };
    if (isReduced || value === theme) {
      show();
    } else {
      document.startViewTransition(show);
    }
    setTheme(value);
  };

  return (
    <SetupPageSwitch
      depth={isAllSet ? 1 : 0}
      page={isAllSet ? "all-set" : "look"}
    >
      {isAllSet ? (
        <AllSetPage onFinish={onFinish} />
      ) : (
        <SetupPage
          align="center"
          footer={
            <SetupFooter
              onBack={onBack}
              onContinue={() => {
                if (isLast) {
                  setIsAllSet(true);
                } else {
                  onContinue();
                }
              }}
            />
          }
          subtitle="You can change this any time in Settings"
          title="Pick a theme"
        >
          <div
            className="mt-8 flex items-center gap-5 rounded-[32px] border-2 border-white/30 bg-white/30 p-6 dark:border-white/5 dark:bg-setup-tile"
            role="radiogroup"
          >
            {THEMES.map((option) => (
              <ThemeOptionButton
                isSelected={theme === option.value}
                key={option.value}
                label={option.label}
                onSelect={() => {
                  pick(option.value);
                }}
                value={option.value}
              />
            ))}
          </div>
        </SetupPage>
      )}
    </SetupPageSwitch>
  );
}

function ThemeOptionButton({
  isSelected,
  label,
  onSelect,
  value,
}: {
  isSelected: boolean;
  label: string;
  onSelect: () => void;
  value: ThemeOption;
}) {
  return (
    <button
      aria-checked={isSelected}
      className="group flex flex-col items-center gap-3 rounded-2xl outline-none"
      onClick={onSelect}
      role="radio"
      type="button"
    >
      <span
        className={cn(
          // Drawn in rings, which take no room, so picking one moves nothing.
          "rounded-2xl p-1.25 group-focus-visible:outline-[3px] group-focus-visible:outline-ring/50 group-focus-visible:[outline-style:solid]",
          isSelected
            ? "ring-3 inset-ring ring-brand-500 inset-ring-brand-500"
            : "bg-setup-tile shadow-xs",
        )}
      >
        <span className="relative block h-37.5 w-58 overflow-hidden rounded-[11px]">
          {value === "system" ? (
            <>
              <AppPicture dark={false} />
              <span className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
                <AppPicture dark />
              </span>
            </>
          ) : (
            <AppPicture dark={value === "dark"} />
          )}
        </span>
      </span>
      <span
        className={cn(
          "text-sm font-medium",
          isSelected ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </button>
  );
}

/** The app drawn small, in one theme: the rail, a list, and a chat. Gray stops are fixed in both themes. */
function AppPicture({ dark }: { dark: boolean }) {
  const line = dark ? "bg-gray-700" : "bg-gray-200";
  const rail = dark ? "bg-gray-600" : "bg-gray-300";
  return (
    <span
      className={cn("absolute inset-0", dark ? "bg-gray-900" : "bg-gray-200")}
    >
      <span className="absolute top-6 left-2 size-2.5 rounded-full bg-brand-600" />
      {[40, 53, 66, 79].map((top) => (
        <span
          className={cn("absolute left-2.5 size-1.75 rounded-xs", rail)}
          key={top}
          style={{ top }}
        />
      ))}
      <span
        className={cn(
          "absolute top-5 left-6.5 h-31 w-50 overflow-hidden rounded-md",
          dark ? "bg-gray-800" : "bg-white",
        )}
      >
        <span className={cn("absolute top-0 left-19 h-full w-px", line)} />
        {[
          [7, 55.8],
          [17, 43.4],
          [27, 49.6],
          [37, 37.2],
          [47, 46.5],
        ].map(([top, width]) => (
          <span
            className={cn("absolute left-1.75 h-1 rounded-xs", line)}
            key={top}
            style={{ top, width }}
          />
        ))}
        <span
          className={cn(
            "absolute top-2 left-33 h-2.5 w-15 rounded-[5px] bg-brand-100",
            dark && "opacity-55",
          )}
        />
        <span
          className={cn(
            "absolute top-6 left-21 h-4 w-21.5 rounded-[5px]",
            line,
          )}
        />
        <span
          className={cn(
            "absolute top-11.5 left-21 h-2.5 w-16 rounded-[5px]",
            line,
          )}
        />
      </span>
    </span>
  );
}

/**
 * The last page (frame 15): one line and one button, which finishes setup.
 * The first name only when the Instrument account gave one. Its words rise
 * in as it arrives.
 */
function AllSetPage({ onFinish }: { onFinish: () => void }) {
  const { data: user } = useLiveUser();
  const firstName = user?.name.trim().split(/\s+/)[0];
  return (
    <SetupPage
      align="center"
      className="setup-rise-in"
      footer={<SetupFooter back={false} next="none" />}
      hero={<BrandMark className="mb-4" size={88} />}
      title={firstName ? `You're all set, ${firstName}` : "You're all set"}
    >
      <Button
        className="mt-8 h-10 px-8 text-base"
        onClick={onFinish}
        variant="brand"
      >
        Open {APP_NAME}
      </Button>
    </SetupPage>
  );
}
