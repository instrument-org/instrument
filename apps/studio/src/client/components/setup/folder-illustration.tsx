import folderBackSrc from "@/client/assets/setup/folder-back.svg";
import folderFrontSrc from "@/client/assets/setup/folder-front.svg";
import folderShadowSrc from "@/client/assets/setup/folder-shadow.svg";
import { cn } from "@/client/lib/utils";
import { type ReactNode } from "react";

import {
  ChartVignette,
  DocVignette,
  PdfVignette,
  PhotoVignette,
  SheetVignette,
} from "./vignettes";

/**
 * Figma's packed folder (Illustration/Packed folder): the Instrument folder
 * with a photo, a sheet, a document, a chart and a PDF sticking out of it,
 * the things Instrument keeps there. Drawn in fixed light colors in both
 * themes, as a picture.
 */
export function PackedFolder() {
  return (
    <div aria-hidden className="relative h-46 w-140 vignettes-light">
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
      <Tilted angle={30} className="top-8.5 left-[127px] h-[88px] w-[92.4px]">
        <PhotoVignette />
      </Tilted>
      <Tilted angle={30} className="top-8 left-86 h-[82.5px] w-[86.9px]">
        <PdfVignette />
      </Tilted>
      <Tilted
        angle={-30}
        className="top-[-12.4px] left-[174.2px] h-[101.4px] w-[111.7px]"
      >
        <SheetVignette />
      </Tilted>
      <Tilted
        angle={30}
        className="top-[-14.4px] left-[271.9px] h-[106.4px] w-[112.2px]"
      >
        <ChartVignette />
      </Tilted>
      <div className="absolute top-[6px] left-58">
        <DocVignette />
      </div>
      <img
        alt=""
        className="absolute top-4.5 left-[185px] size-47.5 max-w-none"
        src={folderFrontSrc}
      />
    </div>
  );
}

function Tilted({
  angle,
  children,
  className,
}: {
  angle: number;
  children: ReactNode;
  className: string;
}) {
  return (
    <div className={cn("absolute flex items-center justify-center", className)}>
      <div style={{ transform: `rotate(${String(angle)}deg)` }}>{children}</div>
    </div>
  );
}
