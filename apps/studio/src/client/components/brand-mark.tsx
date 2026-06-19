import brandMarkSrc from "@/client/assets/app-icon-stylized.png";

interface BrandMarkProps {
  className?: string;
  size?: number | string;
}

export function BrandMark({ className, size }: BrandMarkProps) {
  return (
    <img
      alt=""
      aria-hidden
      className={className}
      draggable={false}
      height={size}
      src={brandMarkSrc}
      width={size}
    />
  );
}
