import { cn } from "@/client/lib/utils";
import { APP_NAME } from "@instrument-org/shared";
import { XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useId } from "react";

import { Button } from "../ui/button";

export function TutorialPromptCard({
  children,
  isDismissPending,
  isVisible,
  onDismiss,
}: {
  children: ReactNode;
  isDismissPending: boolean;
  isVisible: boolean;
  onDismiss: () => void;
}) {
  return (
    <div className="relative">
      <AnimatePresence>
        {isVisible && (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="pointer-events-none absolute inset-0 -z-10 rounded-[24px] border border-black/5 bg-gradient-to-t from-gray-50 from-[24.779%] to-yellow-50 drop-shadow-[0_1px_4px_rgba(0,0,0,0.04)] dark:border-transparent dark:bg-[color-mix(in_srgb,var(--yellow-300)_20%,var(--background))] dark:bg-none dark:shadow-[0px_1px_8px_-4px_rgba(0,0,0,0.04)] dark:drop-shadow-none"
            exit={{
              opacity: 0,
              transition: { damping: 22, stiffness: 320, type: "spring" },
              y: 4,
            }}
            initial={{ opacity: 0, y: 4 }}
            transition={{
              delay: 0.35,
              duration: 0.35,
              ease: [0.25, 0.1, 0.25, 1],
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isVisible && (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={{
              height: 0,
              opacity: 0,
              transition: { damping: 22, stiffness: 320, type: "spring" },
            }}
            initial={{ height: 0, opacity: 0 }}
            transition={{
              delay: 0.35,
              duration: 0.35,
              ease: [0.25, 0.1, 0.25, 1],
            }}
          >
            <div className="flex items-start gap-3 px-4 pt-4 pb-3">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <RocketGradientIcon className="size-5" />
                  <p className="min-w-0 truncate text-sm leading-5 font-semibold text-gray-950 dark:text-yellow-50">
                    This is your first {APP_NAME} task
                  </p>
                </div>
                <p className="mt-1 text-sm leading-5 text-black/60 dark:text-yellow-50/70">
                  Tasks in {APP_NAME} are where you talk to the {APP_NAME} AI
                  and get things done. This is an example task to teach you how
                  to use {APP_NAME}.
                </p>
              </div>
              <Button
                aria-label="Dismiss tutorial prompt"
                className="-m-1.5 size-7 rounded-md p-0 text-gray-400 hover:bg-black/5 hover:text-gray-950 dark:text-yellow-300/70 dark:hover:bg-white/10 dark:hover:text-yellow-50"
                disabled={isDismissPending}
                onClick={onDismiss}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <XIcon className="size-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        animate={{
          paddingBottom: isVisible ? 8 : 0,
          paddingLeft: isVisible ? 8 : 0,
          paddingRight: isVisible ? 8 : 0,
        }}
        transition={
          isVisible
            ? { delay: 0.35, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }
            : { damping: 22, stiffness: 320, type: "spring" }
        }
      >
        {children}
      </motion.div>
    </div>
  );
}

function RocketGradientIcon({ className }: { className?: string }) {
  const id = useId().replaceAll(":", "");
  const gradientId = `tutorial-rocket-${id}`;

  return (
    <svg
      className={cn("shrink-0", className)}
      fill="none"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(2 2)">
        <path
          d="M6.08126 12.4334C5.72892 13.2037 4.55314 15.0006 1.24923 15.0006C1.08347 15.0006 0.924498 14.9347 0.807288 14.8175C0.690078 14.7003 0.62423 14.5413 0.62423 14.3756C0.62423 11.0717 2.4211 9.89589 3.19142 9.54355C3.26611 9.50949 3.34677 9.49047 3.42881 9.48759C3.51085 9.4847 3.59265 9.498 3.66955 9.52673C3.74645 9.55546 3.81694 9.59905 3.87699 9.65502C3.93704 9.71099 3.98548 9.77824 4.01954 9.85293C4.0536 9.92761 4.07262 10.0083 4.07551 10.0903C4.07839 10.1724 4.06509 10.2542 4.03637 10.3311C4.00764 10.408 3.96404 10.4784 3.90808 10.5385C3.85211 10.5985 3.78486 10.647 3.71017 10.6811C3.20782 10.91 2.09923 11.6467 1.90392 13.7209C3.97814 13.5256 4.71642 12.417 4.94376 11.9146C4.97782 11.84 5.02626 11.7727 5.08631 11.7167C5.14636 11.6608 5.21685 11.6172 5.29375 11.5884C5.37065 11.5597 5.45245 11.5464 5.53449 11.5493C5.61653 11.5522 5.6972 11.5712 5.77189 11.6053C5.84658 11.6393 5.91382 11.6878 5.96979 11.7478C6.02576 11.8079 6.06936 11.8784 6.09808 11.9553C6.12681 12.0322 6.14011 12.114 6.13723 12.196C6.13434 12.278 6.11532 12.3587 6.08126 12.4334ZM15.6125 1.18339C15.594 0.878649 15.4646 0.591219 15.2487 0.375334C15.0328 0.159449 14.7454 0.0300386 14.4406 0.0115191C13.4578 -0.0470746 10.9461 0.042769 8.86251 2.12636L4.99923 5.99277C4.94121 6.05089 4.87232 6.09701 4.79647 6.12851C4.72063 6.16 4.63933 6.17625 4.5572 6.17632C4.39135 6.17647 4.23223 6.11072 4.11485 5.99355C3.99748 5.87638 3.93145 5.71738 3.9313 5.55152C3.93116 5.38567 3.9969 5.22655 4.11407 5.10918L6.18907 3.03339C6.23251 2.9897 6.26207 2.93413 6.27402 2.87369C6.28597 2.81324 6.27978 2.75061 6.25624 2.69367C6.23269 2.63673 6.19284 2.58802 6.14169 2.55366C6.09054 2.51931 6.03038 2.50084 5.96876 2.50058H3.93282C3.76817 2.49971 3.60498 2.53159 3.45275 2.59436C3.30053 2.65713 3.1623 2.74953 3.0461 2.86621L0.366417 5.54746C0.20208 5.71168 0.0867628 5.91846 0.0334084 6.14458C-0.0199459 6.3707 -0.0092263 6.60721 0.0643644 6.82758C0.137955 7.04795 0.271504 7.24344 0.450024 7.39213C0.628544 7.54082 0.844969 7.63681 1.07501 7.66933L4.08048 8.08886L7.53439 11.5428L7.95392 14.5498C7.98618 14.7799 8.08215 14.9963 8.23097 15.1747C8.3798 15.353 8.57555 15.4862 8.79611 15.5592C8.92456 15.6021 9.05911 15.624 9.19454 15.624C9.35854 15.6243 9.52097 15.5922 9.67249 15.5294C9.824 15.4667 9.9616 15.3746 10.0774 15.2584L12.7586 12.5787C12.8749 12.4623 12.9671 12.324 13.0298 12.1718C13.0926 12.0196 13.1247 11.8566 13.1242 11.692V9.65605C13.1241 9.59427 13.1057 9.53392 13.0713 9.4826C13.0369 9.43128 12.9881 9.39131 12.931 9.36774C12.8739 9.34416 12.8111 9.33804 12.7505 9.35014C12.6899 9.36224 12.6343 9.39203 12.5906 9.43574L10.5149 11.5107C10.4541 11.5715 10.3816 11.6191 10.3016 11.6506C10.2217 11.682 10.1361 11.6967 10.0503 11.6936C9.96444 11.6905 9.88015 11.6698 9.80268 11.6327C9.7252 11.5956 9.65621 11.5429 9.60001 11.4779C9.49749 11.3539 9.44539 11.1958 9.45408 11.0352C9.46276 10.8745 9.53159 10.723 9.64689 10.6107L13.4961 6.76152C15.5813 4.67714 15.6711 2.16543 15.6125 1.18183V1.18339Z"
          fill={`url(#${gradientId})`}
        />
      </g>
      <defs>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id={gradientId}
          x1="9.81201"
          x2="9.81201"
          y1="2"
          y2="17.624"
        >
          <stop stopColor="var(--yellow-300)" />
          <stop offset="1" stopColor="var(--yellow-700)" />
        </linearGradient>
      </defs>
    </svg>
  );
}
