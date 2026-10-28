import folderBackSrc from "@/client/assets/setup/folder-back.svg";
import folderFrontSrc from "@/client/assets/setup/folder-front.svg";
import folderShadowSrc from "@/client/assets/setup/folder-shadow.svg";
import { cn } from "@/client/lib/utils";
import { type ReactNode, useRef } from "react";

import { useHeroPieces } from "./hero-morph";

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
 * Each page's burst starts at the folder's middle. On from Welcome, its
 * picture turns into this one instead (`useHeroPieces`): the pages fly into
 * the folder and the icon grows into it.
 */
export function PackedFolder() {
  const ref = useRef<HTMLDivElement>(null);
  const morph = useHeroPieces(ref);
  return (
    <div aria-hidden className="relative h-46 w-140" ref={ref}>
      <img
        alt=""
        className="absolute top-[164.3px] left-[199.8px] h-9.5 w-[160.4px] max-w-none"
        data-hero-piece="shadow"
        src={folderShadowSrc}
      />
      <img
        alt=""
        className="absolute top-4.5 left-[185px] size-47.5 max-w-none"
        data-hero-piece="vessel"
        src={folderBackSrc}
      />
      <Tilted
        burst="[--burst-delay:150ms] [--burst-rotate:-60deg] [--burst-x:107px] [--burst-y:35px]"
        className="top-[42px] left-[143.2px]"
        morph={morph}
        name="photo"
        rotate={-60}
      >
        <PhotoIllustration />
      </Tilted>
      <Tilted
        burst="[--burst-delay:210ms] [--burst-rotate:60deg] [--burst-x:-107px] [--burst-y:40px]"
        className="top-[39.25px] left-[359.45px]"
        morph={morph}
        name="pdf"
        rotate={60}
      >
        <PdfIllustration />
      </Tilted>
      <Tilted
        burst="[--burst-delay:270ms] [--burst-rotate:-30deg] [--burst-x:50px] [--burst-y:74px]"
        className="top-[6.28px] left-46"
        morph={morph}
        name="sheet"
        rotate={-30}
      >
        <SheetIllustration />
      </Tilted>
      <Tilted
        burst="[--burst-delay:330ms] [--burst-rotate:30deg] [--burst-x:-48px] [--burst-y:74px]"
        className="top-[2.82px] left-71"
        morph={morph}
        name="chart"
        rotate={30}
      >
        <ChartIllustration />
      </Tilted>
      <Tilted
        burst="[--burst-delay:390ms] [--burst-rotate:0deg] [--burst-x:0px] [--burst-y:67px]"
        className="top-[6px] left-58"
        morph={morph}
        name="doc"
        rotate={0}
      >
        <DocIllustration />
      </Tilted>
      <img
        alt=""
        className="absolute top-4.5 left-[185px] size-47.5 max-w-none"
        data-hero-piece="vessel"
        src={folderFrontSrc}
      />
      {/* The folder's front as a square, which Welcome's app icon turns
        into and out of. */}
      <div
        className="absolute top-[70px] left-[223.6px] size-[112.8px]"
        data-hero-box="vessel"
      />
    </div>
  );
}

/**
 * A page at its place in the picture, its box where the page sits untilted,
 * tilted about its middle as it bursts.
 */
function Tilted({
  burst,
  children,
  className,
  morph,
  name,
  rotate,
}: {
  burst: string;
  children: ReactNode;
  className: string;
  morph: boolean;
  /** The page's name in Welcome's picture, which it flies from. */
  name: string;
  rotate: number;
}) {
  return (
    <div
      className={cn("absolute", className)}
      data-hero-piece={name}
      data-rotate={rotate}
    >
      <div
        className={cn(
          morph ? "rotate-(--burst-rotate)" : "welcome-burst-page",
          burst,
        )}
      >
        {children}
      </div>
    </div>
  );
}
