import { BrandMark } from "@/client/components/brand-mark";
import { cn } from "@/client/lib/utils";
import { type ReactNode, useRef } from "react";

import { useHeroPieces } from "./hero-morph";

import {
  ChartIllustration,
  DocIllustration,
  PageIllustration,
  PdfIllustration,
  PhotoIllustration,
  SheetIllustration,
} from "./work-illustrations";

/**
 * Each page around the icon: where it ends and its size (Figma's 01 Welcome,
 * at the 560-wide size the work illustrations are drawn at), its name in
 * the packed folder it turns into, its tilt, and in its classes where it
 * springs from, its tilt again and when it goes.
 */
const PAGES: {
  burst: string;
  className: string;
  name: string;
  page: ReactNode;
  rotate: number;
}[] = [
  {
    burst:
      "[--burst-delay:850ms] [--burst-rotate:-6deg] [--burst-x:84px] [--burst-y:40px]",
    className: "top-6 left-37.5 z-2",
    name: "sheet",
    page: <SheetIllustration />,
    rotate: -6,
  },
  {
    burst:
      "[--burst-delay:910ms] [--burst-rotate:5deg] [--burst-x:-78px] [--burst-y:42px]",
    className: "top-[17px] left-77 z-2",
    name: "page",
    page: <PageIllustration />,
    rotate: 5,
  },
  {
    burst:
      "[--burst-delay:970ms] [--burst-rotate:-9deg] [--burst-x:128px] [--burst-y:-22px]",
    className: "top-19.5 left-26 z-3",
    name: "doc",
    page: <DocIllustration />,
    rotate: -9,
  },
  {
    burst:
      "[--burst-delay:1030ms] [--burst-rotate:8deg] [--burst-x:-128px] [--burst-y:-20px]",
    className: "top-20 left-91 z-3",
    name: "chart",
    page: <ChartIllustration />,
    rotate: 8,
  },
  {
    burst:
      "[--burst-delay:1090ms] [--burst-rotate:7deg] [--burst-x:62px] [--burst-y:-54px]",
    className: "top-28.5 left-47 z-4",
    name: "photo",
    page: <PhotoIllustration />,
    rotate: 7,
  },
  {
    burst:
      "[--burst-delay:1150ms] [--burst-rotate:-8deg] [--burst-x:-68px] [--burst-y:-56px]",
    className: "top-29.5 left-80 z-4",
    name: "pdf",
    page: <PdfIllustration />,
    rotate: -8,
  },
];

/**
 * Welcome's picture (Figma's Illustration/Welcome burst): the app icon with
 * a sheet, a browser page, a document, a chart, a photo and a PDF around it.
 * On mount the icon scales in and the pages spring out from behind it, once;
 * with reduced motion it shows where they end. Back from the folder page,
 * the packed folder turns into it instead (`useHeroPieces`).
 */
export function WelcomeBurst() {
  const ref = useRef<HTMLDivElement>(null);
  const morph = useHeroPieces(ref);
  return (
    <div aria-hidden className="relative h-37.5 w-107" ref={ref}>
      <div className="absolute top-0 left-0 h-49 w-140 origin-top-left scale-[0.765] [--vignette-scale:0.765]">
        {PAGES.map(({ burst, className, name, page, rotate }) => (
          <div
            className={cn("absolute", className)}
            data-hero-piece={name}
            data-rotate={rotate}
            key={name}
          >
            <div
              className={cn(
                morph ? "rotate-(--burst-rotate)" : "welcome-burst-page",
                burst,
              )}
            >
              {page}
            </div>
          </div>
        ))}
        <div className="absolute top-11 left-57 z-10" data-hero-piece="vessel">
          <div className={morph ? undefined : "welcome-burst-icon"}>
            <BrandMark className="size-26 drop-shadow-md" />
          </div>
        </div>
      </div>
    </div>
  );
}
