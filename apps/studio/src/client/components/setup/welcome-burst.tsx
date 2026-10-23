import { BrandMark } from "@/client/components/brand-mark";
import { cn } from "@/client/lib/utils";
import { type ReactNode } from "react";

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
 * at the 560-wide size the work illustrations are drawn at), and in its classes where
 * it springs from, its tilt and when it goes.
 */
const PAGES: {
  burst: string;
  className: string;
  page: ReactNode;
}[] = [
  {
    burst:
      "[--burst-delay:850ms] [--burst-rotate:-6deg] [--burst-x:84px] [--burst-y:40px]",
    className: "top-6 left-37.5 z-2",
    page: <SheetIllustration />,
  },
  {
    burst:
      "[--burst-delay:910ms] [--burst-rotate:5deg] [--burst-x:-78px] [--burst-y:42px]",
    className: "top-[17px] left-77 z-2",
    page: <PageIllustration />,
  },
  {
    burst:
      "[--burst-delay:970ms] [--burst-rotate:-9deg] [--burst-x:128px] [--burst-y:-22px]",
    className: "top-19.5 left-26 z-3",
    page: <DocIllustration />,
  },
  {
    burst:
      "[--burst-delay:1030ms] [--burst-rotate:8deg] [--burst-x:-128px] [--burst-y:-20px]",
    className: "top-20 left-91 z-3",
    page: <ChartIllustration />,
  },
  {
    burst:
      "[--burst-delay:1090ms] [--burst-rotate:7deg] [--burst-x:62px] [--burst-y:-54px]",
    className: "top-28.5 left-47 z-4",
    page: <PhotoIllustration />,
  },
  {
    burst:
      "[--burst-delay:1150ms] [--burst-rotate:-8deg] [--burst-x:-68px] [--burst-y:-56px]",
    className: "top-29.5 left-80 z-4",
    page: <PdfIllustration />,
  },
];

/**
 * Welcome's picture (Figma's Illustration/Welcome burst): the app icon with
 * a sheet, a browser page, a document, a chart, a photo and a PDF around it.
 * On mount the icon scales in and the pages spring out from behind it, once;
 * with reduced motion it shows where they end.
 */
export function WelcomeBurst() {
  return (
    <div aria-hidden className="relative h-37.5 w-107">
      <div className="absolute top-0 left-0 h-49 w-140 origin-top-left scale-[0.765]">
        {PAGES.map(({ burst, className, page }) => (
          <div
            className={cn("absolute welcome-burst-page", burst, className)}
            key={className}
          >
            {page}
          </div>
        ))}
        <div className="absolute top-11 left-57 z-10 welcome-burst-icon">
          <BrandMark className="size-26 drop-shadow-md" />
        </div>
      </div>
    </div>
  );
}
