import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import { ExternalLink } from "@/client/components/external-link";
import { cn } from "@/client/lib/utils";
import { APP_URL } from "@instrument-org/shared";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { MicrophoneIcon } from "@phosphor-icons/react/Microphone";
import { SparkleIcon } from "@phosphor-icons/react/Sparkle";
import { type ReactNode } from "react";
import { FcGoogle } from "react-icons/fc";

/** A product's mark on a white tile: 64px over a page's title, 36px in a row. */
export function ProductTile({
  children,
  size = "row",
}: {
  children: ReactNode;
  size?: "head" | "row";
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center bg-white text-black ring-1 ring-black/[0.08]",
        size === "head" ? "size-16 rounded-[17px]" : "size-9 rounded-[10px]",
      )}
    >
      {children}
    </span>
  );
}

export function ChatGPTMark({ size = "row" }: { size?: "head" | "row" }) {
  return (
    <AIProviderIcon
      className={size === "head" ? "size-7" : "size-5"}
      type="chatgpt-account"
    />
  );
}

export function ClaudeMark({ size = "row" }: { size?: "head" | "row" }) {
  return (
    <AIProviderIcon
      className={size === "head" ? "size-7" : "size-5"}
      colored
      type="claude-account"
    />
  );
}

/** A tile with a small round badge at its bottom right, for what went wrong. */
export function BadgedTile({
  badge,
  children,
}: {
  badge: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className="relative inline-block">
      {children}
      <span className="absolute -right-2 -bottom-2 grid size-7 place-items-center rounded-full bg-white shadow-[0_4px_10px_-3px_rgba(28,25,23,0.35)] ring-1 ring-black/[0.08]">
        {badge}
      </span>
    </span>
  );
}

/** A rounded square holding a glyph, in the brand's tint or a neutral one. */
export function IconWell({
  children,
  tone = "brand",
}: {
  children: ReactNode;
  tone?: "brand" | "neutral";
}) {
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-[11px] [&_svg]:size-5",
        tone === "brand"
          ? "bg-brand-600/13 text-brand-700 dark:text-brand-300"
          : "bg-foreground/[0.07] text-foreground/60",
      )}
    >
      {children}
    </span>
  );
}

/**
 * The large white pill each way in starts from. It hands off to the browser
 * like the sign-in buttons elsewhere: while the browser has it, it holds as a
 * spinner and Cancel.
 */
export function WayInButton({
  children,
  className,
  icon,
  onCancel,
  onStart,
  waiting = false,
}: {
  children: ReactNode;
  className?: string;
  icon: ReactNode;
  onCancel?: () => void;
  onStart: () => void;
  waiting?: boolean;
}) {
  return (
    <BrowserHandoffButton
      className={cn(
        "h-12 gap-2.5 rounded-full text-[15px] font-medium shadow-xs ring-1 ring-black/10 dark:ring-white/10 [&_svg:not([class*='size-'])]:size-5",
        className,
      )}
      icon={icon}
      onCancel={onCancel ?? (() => {})}
      onStart={onStart}
      variant="default"
      waiting={waiting}
    >
      {children}
    </BrowserHandoffButton>
  );
}

export function GoogleButton({
  onCancel,
  onStart,
  waiting,
}: {
  onCancel: () => void;
  onStart: () => void;
  waiting: boolean;
}) {
  return (
    <WayInButton
      className="w-85"
      icon={<FcGoogle className="size-5" />}
      onCancel={onCancel}
      onStart={onStart}
      waiting={waiting}
    >
      Continue with Google
    </WayInButton>
  );
}

export const GOOGLE_TILE = (
  <ProductTile>
    <FcGoogle className="size-5" />
  </ProductTile>
);

const PERKS = [
  {
    detail: "Fast, up-to-date answers from the web",
    icon: <MagnifyingGlassIcon />,
    title: "Web search",
  },
  {
    detail: "Talk instead of typing",
    icon: <MicrophoneIcon />,
    title: "Dictation",
  },
  {
    detail:
      "Topics for new chats, and search that finds a chat by what it's about",
    icon: <SparkleIcon />,
    title: "Smart suggestions",
  },
];

/** What a free Instrument account adds, whichever AI they connected. */
export function PerkCards() {
  return (
    <div className="mt-8 grid w-180 max-w-full grid-cols-3 gap-3">
      {PERKS.map((perk) => (
        <div
          className="flex flex-col gap-3 rounded-2xl bg-card p-4 text-left shadow-xs ring-1 ring-black/[0.07] dark:ring-white/10"
          key={perk.title}
        >
          <IconWell>{perk.icon}</IconWell>
          <div>
            <div className="text-sm font-medium text-foreground">
              {perk.title}
            </div>
            <div className="mt-0.5 text-xs leading-snug text-foreground/55">
              {perk.detail}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function LegalLine() {
  return (
    <p className="text-center text-[11px] text-foreground/40 [&_a]:underline [&_a]:underline-offset-2">
      By continuing, you agree to the{" "}
      <ExternalLink href={`${APP_URL}/terms`}>Terms of Service</ExternalLink>{" "}
      and{" "}
      <ExternalLink href={`${APP_URL}/privacy`}>Privacy Policy</ExternalLink>.
    </p>
  );
}
