import folderBackSrc from "@/client/assets/setup/folder-back.svg";
import folderFrontSrc from "@/client/assets/setup/folder-front.svg";
import folderShadowSrc from "@/client/assets/setup/folder-shadow.svg";
import { cn } from "@/client/lib/utils";
import { type ReactNode } from "react";

import {
  ChartIllustration,
  DocIllustration,
  PdfIllustration,
  PhotoIllustration,
  SheetIllustration,
} from "./work-illustrations";

/**
 * Figma's packed folder (Illustration/Packed folder): the Instrument folder
 * with a photo, a sheet, a document, a chart and a PDF sticking out of it,
 * the things Instrument keeps there. The pages are Welcome's, in the theme's
 * colors, and on mount they spring up out of the folder once, as Welcome's
 * do from behind the icon; with reduced motion they show where they end.
 * Each page's burst starts at the folder's middle.
 */
export function PackedFolder() {
  return (
    <div aria-hidden className="relative h-46 w-140">
      <img
        alt=""
        className="absolute top-[164.3px] left-[199.8px] h-9.5 w-[160.4px] max-w-none"
        src={folderShadowSrc}
      />
      <img
        alt=""
        className="absolute top-4.5 left-[185px] size-47.5 max-w-none"
        src={folderBackSrc}
      />
      <Tilted
        burst="[--burst-delay:150ms] [--burst-rotate:30deg] [--burst-x:107px] [--burst-y:35px]"
        className="top-8.5 left-[127px] h-[88px] w-[92.4px]"
      >
        <PhotoIllustration />
      </Tilted>
      <Tilted
        burst="[--burst-delay:210ms] [--burst-rotate:30deg] [--burst-x:-107px] [--burst-y:40px]"
        className="top-8 left-86 h-[82.5px] w-[86.9px]"
      >
        <PdfIllustration />
      </Tilted>
      <Tilted
        burst="[--burst-delay:270ms] [--burst-rotate:-30deg] [--burst-x:50px] [--burst-y:74px]"
        className="top-[-12.4px] left-[174.2px] h-[101.4px] w-[111.7px]"
      >
        <SheetIllustration />
      </Tilted>
      <Tilted
        burst="[--burst-delay:330ms] [--burst-rotate:30deg] [--burst-x:-48px] [--burst-y:74px]"
        className="top-[-14.4px] left-[271.9px] h-[106.4px] w-[112.2px]"
      >
        <ChartIllustration />
      </Tilted>
      <Tilted
        burst="[--burst-delay:390ms] [--burst-rotate:0deg] [--burst-x:0px] [--burst-y:67px]"
        className="top-[6px] left-58 h-20 w-24"
      >
        <DocIllustration />
      </Tilted>
      <img
        alt=""
        className="absolute top-4.5 left-[185px] size-47.5 max-w-none"
        src={folderFrontSrc}
      />
    </div>
  );
}

/** A page at its place in the picture, tilted about its middle as it bursts. */
function Tilted({
  burst,
  children,
  className,
}: {
  burst: string;
  children: ReactNode;
  className: string;
}) {
  return (
    <div className={cn("absolute flex items-center justify-center", className)}>
      <div className={cn("welcome-burst-page", burst)}>{children}</div>
    </div>
  );
}
