import { cn } from "@/client/lib/utils";
import { motion } from "motion/react";

function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-label="Loading"
      className={cn("relative flex size-4 shrink-0", className)}
      role="status"
    >
      <span className="absolute inset-0 rounded-full border-2 border-current opacity-15" />
      <motion.span
        animate={{ rotate: [270, 520, 630] }}
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "conic-gradient(from 0deg, transparent 0deg, currentColor 270deg, transparent 270deg)",
          // 1px feathered mask edge (2.5px→1.5px) reduces aliasing vs a hard cutoff;
          // willChange promotes to its own GPU layer for smoother edges during rotation
          mask: "radial-gradient(farthest-side, transparent calc(100% - 2.5px), black calc(100% - 1.5px))",
          WebkitMask:
            "radial-gradient(farthest-side, transparent calc(100% - 2.5px), black calc(100% - 1.5px))",
          willChange: "transform",
        }}
        transition={{
          duration: 1,
          ease: ["easeIn", "easeOut"],
          repeat: Infinity,
          times: [0, 0.45, 1],
        }}
      />
    </span>
  );
}

export { Spinner };
