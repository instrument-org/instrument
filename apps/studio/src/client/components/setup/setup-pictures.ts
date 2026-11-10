import folderBackSrc from "@/client/assets/setup/folder-back.svg";
import folderFrontSrc from "@/client/assets/setup/folder-front.svg";
import folderShadowSrc from "@/client/assets/setup/folder-shadow.svg";
import photoSrc from "@/client/assets/setup/vignette-photo.svg";
import { brandMarkSrc } from "@/client/components/brand-mark";
import { decodeImage, useDecodedEntrance } from "@/client/lib/decoded-images";
import { cn } from "@/client/lib/utils";

/**
 * Every image Welcome's burst and the folder page's packed folder draw. Both
 * wait on all of them, so a picture flying from one into the other always
 * lands on images already decoded.
 */
const SETUP_PICTURES = [
  brandMarkSrc,
  folderBackSrc,
  folderFrontSrc,
  folderShadowSrc,
  photoSrc,
];

// Decoded as the bundle loads, ahead of setup's first render.
for (const src of SETUP_PICTURES) {
  void decodeImage(src);
}

/**
 * For a setup picture's root: hidden, with every animation inside it held at
 * its start, until its images are decoded; then faded in, its burst playing
 * from the beginning. Nothing changes for a picture whose images were ready
 * when it mounted.
 */
export function useSetupPictureEntrance(): string {
  const entrance = useDecodedEntrance(SETUP_PICTURES);
  return cn(
    entrance.className,
    !entrance.ready && "**:[animation-play-state:paused]",
  );
}
