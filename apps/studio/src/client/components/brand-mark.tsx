// Inlined, so the icon is in the bundle rather than a request the main
// process answers: setup's first screen draws it while main may be busy.
import brandMarkSrc from "@/client/assets/app-icon-stylized.png?inline";
import { decodeImage, useDecodedEntrance } from "@/client/lib/decoded-images";
import { cn } from "@/client/lib/utils";

export { brandMarkSrc };

// Decoded as the bundle loads, ahead of setup's first render.
void decodeImage(brandMarkSrc);

const SOURCES = [brandMarkSrc];

interface BrandMarkProps {
  className?: string;
  size?: number | string;
}

/** The app icon, hidden until decoded and faded in if it had to wait. */
export function BrandMark({ className, size }: BrandMarkProps) {
  const entrance = useDecodedEntrance(SOURCES);
  return (
    <img
      alt=""
      aria-hidden
      className={cn(className, entrance.className)}
      draggable={false}
      height={size}
      src={brandMarkSrc}
      width={size}
    />
  );
}
