import { motion } from "motion/react";
import * as React from "react";

type AppIconProps = React.SVGProps<SVGSVGElement> & {
  ref?: React.Ref<SVGSVGElement>;
  size?: number | string;
};

const appIconGlyphPath =
  "M436.675 331.78C408.481 401.395 340.226 450.5 260.5 450.5C180.774 450.5 112.519 401.395 84.3252 331.78H436.675ZM446.977 223.906C449.287 235.748 450.5 247.982 450.5 260.5C450.5 274.88 448.899 288.886 445.872 302.352H314.801C293.139 302.351 275.578 284.791 275.578 263.129C275.578 241.467 293.139 223.906 314.801 223.906H446.977ZM210.199 223.906C231.861 223.906 249.422 241.467 249.422 263.129C249.422 284.791 231.861 302.352 210.199 302.352H75.1279C72.1008 288.886 70.5 274.88 70.5 260.5C70.5 247.982 71.7131 235.748 74.0234 223.906H210.199ZM260.5 70.5C342.227 70.5 411.9 122.101 438.721 194.5H82.2793C109.1 122.101 178.773 70.5 260.5 70.5Z";

const appIconGlyphOutlinePaths = [
  "M82.2793 194.5C109.1 122.101 178.773 70.5 260.5 70.5C342.227 70.5 411.9 122.101 438.721 194.5H82.2793Z",
  "M74.0234 223.906H210.199C231.861 223.906 249.422 241.467 249.422 263.129C249.422 284.791 231.861 302.352 210.199 302.352H75.1279C72.1008 288.886 70.5 274.88 70.5 260.5C70.5 247.982 71.7131 235.748 74.0234 223.906Z",
  "M446.977 223.906C449.287 235.748 450.5 247.982 450.5 260.5C450.5 274.88 448.899 288.886 445.872 302.352H314.801C293.139 302.351 275.578 284.791 275.578 263.129C275.578 241.467 293.139 223.906 314.801 223.906H446.977Z",
  "M84.3252 331.78H436.675C408.481 401.395 340.226 450.5 260.5 450.5C180.774 450.5 112.519 401.395 84.3252 331.78Z",
];

const appIconFillTransition = {
  duration: 0.39,
  ease: "easeOut",
} as const;

const appIconOutlinePathVariants = {
  hover: (index: number) => ({
    opacity: 1,
    pathLength: 1,
    transition: {
      delay: 0.07 + index * 0.09,
      duration: 0.49,
      ease: "easeInOut" as const,
    },
  }),
  rest: {
    opacity: 0,
    pathLength: 0,
    transition: {
      duration: 0.18,
      ease: "easeOut" as const,
    },
  },
};

export const AppIcon = ({ className, ref, size, ...props }: AppIconProps) => {
  return (
    <svg
      className={className}
      fill="none"
      height={size}
      ref={ref}
      viewBox="0 0 520 520"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect fill="#F96B55" height="520" rx="136" width="520" />
      <path d={appIconGlyphPath} fill="#E8E2DA" />
    </svg>
  );
};

export const AppIconGlyph = ({
  className,
  ref,
  size,
  ...props
}: AppIconProps) => {
  return (
    <svg
      className={className}
      fill="none"
      height={size}
      ref={ref}
      viewBox="0 0 520 520"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d={appIconGlyphPath} fill="currentColor" />
    </svg>
  );
};

export const AnimatedOutlineAppIconGlyph = ({
  className,
  ref,
  size,
}: {
  className?: string;
  ref?: React.Ref<SVGSVGElement>;
  size?: number | string;
}) => {
  return (
    <motion.svg
      animate="rest"
      className={className}
      fill="none"
      height={size}
      ref={ref}
      viewBox="0 0 520 520"
      whileHover="hover"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <motion.path
        d={appIconGlyphPath}
        fill="currentColor"
        transition={appIconFillTransition}
        variants={{
          hover: { opacity: 0, scale: 0.97 },
          rest: { opacity: 1 },
        }}
      />
      <motion.g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="9"
      >
        {appIconGlyphOutlinePaths.map((path, index) => (
          <motion.path
            custom={index}
            d={path}
            key={path}
            variants={appIconOutlinePathVariants}
          />
        ))}
      </motion.g>
    </motion.svg>
  );
};
