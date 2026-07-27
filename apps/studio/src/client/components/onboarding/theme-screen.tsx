import { OnboardingScreen } from "@/client/components/onboarding/screen";
import { useTheme } from "@/client/components/theme-provider";
import { Button } from "@/client/components/ui/button";
import { immediateClickHandlers } from "@/client/lib/immediate-click";
import { cn } from "@/client/lib/utils";

type ThemeOption = "dark" | "light" | "system";

function AppMockupDark() {
  return (
    <div className="relative size-full overflow-clip rounded-md bg-[#1c1917]">
      <DarkContent />
    </div>
  );
}

function AppMockupLight() {
  return (
    <div className="relative size-full overflow-clip rounded-md bg-[#f5f5f4]">
      <LightContent />
    </div>
  );
}

function AppMockupSystem() {
  return (
    <div className="relative size-full overflow-clip rounded-md">
      {/* Dark half (top-left) */}
      <div className="absolute inset-0 bg-[#1c1917]">
        <DarkContent />
      </div>
      {/* Light half (bottom-right), diagonal clip */}
      <div
        className="absolute inset-0 bg-[#f5f5f4]"
        style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}
      >
        <LightContent />
      </div>
    </div>
  );
}

function DarkContent() {
  return (
    <>
      {/* Sidebar */}
      <div className="absolute top-0 bottom-0 left-0 flex w-5 flex-col gap-0.5 overflow-clip px-1 pt-2">
        <div className="h-0.5 w-full rounded-sm bg-[#44403c]" />
        <div className="h-0.5 w-full rounded-sm bg-[#292524]" />
        <div className="h-0.5 w-2.5 rounded-sm bg-[#292524]" />
        <div className="h-0.5 w-full rounded-sm bg-[#292524]" />
      </div>
      {/* Main area: two columns */}
      <div className="absolute top-0 right-0 bottom-0 flex w-[calc(100%-21px)] gap-0.5 overflow-clip rounded-r-md bg-[#292524] p-1 pt-2">
        {/* Left col */}
        <div className="flex flex-1 flex-col gap-0.5">
          <div className="h-0.5 w-full rounded-sm bg-[#292524]" />
          <div className="h-0.5 w-4/5 rounded-sm bg-[#44403c]" />
          <div className="h-0.5 w-full rounded-sm bg-[#292524]" />
          <div className="h-0.5 w-3/5 rounded-sm bg-[#292524]" />
          <div className="h-0.5 w-full rounded-sm bg-[#44403c]" />
          {/* Input bar */}
          <div className="mt-auto flex h-[7px] items-center justify-end rounded-sm bg-[#3c3835] px-0.5">
            <div className="size-[5px] rounded-full bg-brand-600" />
          </div>
        </div>
        {/* Right col */}
        <div className="flex w-2/5 flex-col gap-0.5 rounded-sm bg-[#1c1917] p-0.5">
          <div className="h-0.5 w-full rounded-sm bg-[#44403c]" />
          <div className="h-0.5 w-4/5 rounded-sm bg-[#292524]" />
          <div className="h-0.5 w-full rounded-sm bg-[#292524]" />
          <div className="h-0.5 w-3/5 rounded-sm bg-[#292524]" />
        </div>
      </div>
    </>
  );
}

function LightContent() {
  return (
    <>
      {/* Sidebar */}
      <div className="absolute top-0 bottom-0 left-0 flex w-5 flex-col gap-0.5 overflow-clip px-1 pt-2">
        <div className="h-0.5 w-full rounded-sm bg-[#d7d3d0]" />
        <div className="h-0.5 w-full rounded-sm bg-[#e7e5e4]" />
        <div className="h-0.5 w-2.5 rounded-sm bg-[#e7e5e4]" />
        <div className="h-0.5 w-full rounded-sm bg-[#e7e5e4]" />
      </div>
      {/* Main area: two columns */}
      <div className="absolute top-0 right-0 bottom-0 flex w-[calc(100%-21px)] gap-0.5 overflow-clip rounded-r-md bg-white p-1 pt-2">
        {/* Left col */}
        <div className="flex flex-1 flex-col gap-0.5">
          <div className="h-0.5 w-full rounded-sm bg-[#e7e5e4]" />
          <div className="h-0.5 w-4/5 rounded-sm bg-[#e7e5e4]" />
          <div className="h-0.5 w-full rounded-sm bg-[#fafaf9]" />
          <div className="h-0.5 w-3/5 rounded-sm bg-[#e7e5e4]" />
          <div className="h-0.5 w-full rounded-sm bg-[#e7e5e4]" />
          {/* Input bar */}
          <div className="mt-auto flex h-[7px] items-center justify-end rounded-sm bg-[#e7e5e4] px-0.5 shadow-[0_0.2px_0.8px_rgba(0,0,0,0.06)]">
            <div className="size-[5px] rounded-full bg-brand-600" />
          </div>
        </div>
        {/* Right col */}
        <div className="flex w-2/5 flex-col gap-0.5 rounded-sm bg-[#f5f5f4] p-0.5">
          <div className="h-0.5 w-full rounded-sm bg-[#d7d3d0]" />
          <div className="h-0.5 w-4/5 rounded-sm bg-[#e7e5e4]" />
          <div className="h-0.5 w-full rounded-sm bg-[#e7e5e4]" />
          <div className="h-0.5 w-3/5 rounded-sm bg-[#e7e5e4]" />
        </div>
      </div>
    </>
  );
}

const MOCKUP: Record<ThemeOption, React.ComponentType> = {
  dark: AppMockupDark,
  light: AppMockupLight,
  system: AppMockupSystem,
};

const LABELS: Record<ThemeOption, string> = {
  dark: "Dark",
  light: "Light",
  system: "System",
};

const THEMES: ThemeOption[] = ["light", "dark", "system"];

export function OnboardingThemeScreen({
  onContinue,
}: {
  onContinue?: () => void;
}) {
  const { setTheme, theme } = useTheme();
  const selectedTheme: ThemeOption = theme;

  return (
    <OnboardingScreen align="between" className="pt-20">
      <div className="flex w-full flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="font-serif text-3xl font-medium tracking-tight text-foreground">
            Pick a theme
          </h1>
          <p className="text-sm text-foreground/60">
            Update your choice any time in settings
          </p>
        </div>

        <div className="flex items-center justify-center gap-3 rounded-3xl bg-white/30 p-4 outline-2 outline-white/30 dark:bg-white/5 dark:outline-white/5">
          {THEMES.map((t) => (
            <ThemeCard
              isSelected={selectedTheme === t}
              key={t}
              onClick={() => {
                setTheme(t);
              }}
              theme={t}
            />
          ))}
        </div>

        <div className="flex w-full max-w-xs flex-col items-center gap-2.5">
          <Button onClick={onContinue} type="button" variant="default">
            Continue
          </Button>
        </div>
      </div>
    </OnboardingScreen>
  );
}

function ThemeCard({
  isSelected,
  onClick,
  theme,
}: {
  isSelected: boolean;
  onClick: () => void;
  theme: ThemeOption;
}) {
  const Mockup = MOCKUP[theme];

  return (
    <button
      className="flex flex-col items-center gap-2.5 focus-visible:outline-none"
      {...immediateClickHandlers<HTMLButtonElement>({
        onClick,
      })}
      type="button"
    >
      <div
        className={cn(
          "rounded-xl p-1 shadow-[0_1px_3px_0_rgba(10,13,18,0.1),0_1px_2px_0_rgba(10,13,18,0.06)]",
          "bg-white transition-all duration-150 dark:bg-white/10",
          isSelected
            ? "outline-[3px] outline-brand-600"
            : "outline-[1px] outline-black/8 dark:outline-white/10",
        )}
      >
        <div className="h-[68px] w-24 overflow-hidden rounded-lg">
          <Mockup />
        </div>
      </div>
      <span
        className={cn(
          "text-sm font-medium",
          isSelected ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {LABELS[theme]}
      </span>
    </button>
  );
}
