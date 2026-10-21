import folderBackSrc from "@/client/assets/setup/folder-back.svg";
import folderFrontSrc from "@/client/assets/setup/folder-front.svg";
import folderShadowSrc from "@/client/assets/setup/folder-shadow.svg";
import photoSrc from "@/client/assets/setup/vignette-photo.svg";
import { cn } from "@/client/lib/utils";
import { FilePdfIcon } from "@phosphor-icons/react/FilePdf";
import { type CSSProperties, type ReactNode } from "react";

/**
 * Figma's packed folder (Illustration/Packed folder): the Instrument folder
 * with a photo, a sheet, a document, a chart and a PDF sticking out of it,
 * the things Instrument keeps there. Drawn in fixed light colors in both
 * themes, as a picture.
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
      <Tilted angle={30} className="top-8.5 left-[127px] h-[88px] w-[92.4px]">
        <Card className="h-18 w-15">
          <img
            alt=""
            className="absolute top-1 left-1 h-16 w-13 max-w-none"
            src={photoSrc}
          />
        </Card>
      </Tilted>
      <Tilted angle={30} className="top-8 left-86 h-[82.5px] w-[86.9px]">
        <Card className="flex h-17 w-14 items-center justify-center text-brand-500">
          <FilePdfIcon className="size-5.5" />
        </Card>
      </Tilted>
      <Tilted
        angle={-30}
        className="top-[-12.4px] left-[174.2px] h-[101.4px] w-[111.7px]"
      >
        <Sheet />
      </Tilted>
      <Tilted
        angle={30}
        className="top-[-14.4px] left-[271.9px] h-[106.4px] w-[112.2px]"
      >
        <Chart />
      </Tilted>
      <Card className="absolute top-[6px] left-58 h-20 w-24">
        <Bar className="top-2.25 left-2.25 h-1 w-[29.6px] bg-yellow-300" />
        <Bar className="top-4.5 left-2.25 h-1.5 w-[62.4px] bg-gray-300" />
        {[31, 39, 47, 55].map((top, index) => (
          <Bar
            className="left-2.25 h-0.75 rounded-[1.5px] bg-gray-200"
            key={top}
            style={{ top, width: [73.3, 59.3, 68.6, 46.8][index] }}
          />
        ))}
      </Card>
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

function Card({
  children,
  className,
}: {
  children?: ReactNode;
  className: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[9px] bg-white shadow-[0_0_0_1px_rgb(10_13_18/0.06),0_1px_2px_-1px_rgb(10_13_18/0.06),0_2px_4px_0_rgb(10_13_18/0.04)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Bar({
  className,
  style,
}: {
  className: string;
  style?: CSSProperties;
}) {
  return <div className={cn("absolute rounded-xs", className)} style={style} />;
}

function Sheet() {
  const columns = [0, 26.43, 48.62, 70.81];
  const widths = [25.43, 21.19, 21.19, 21.19];
  return (
    <Card className="h-16 w-23 bg-gray-200">
      {columns.map((left, index) => (
        <div
          className="absolute top-0 h-2.75 bg-brand-50"
          key={left}
          style={{ left, width: widths[index] }}
        >
          <div className="absolute top-[4.5px] left-0.75 h-0.5 w-3 rounded-[1px] bg-brand-700 opacity-45" />
        </div>
      ))}
      {[12, 24, 36, 48, 60].map((top) =>
        columns.map((left, index) => (
          <div
            className={cn(
              "absolute h-2.75",
              index === 0 ? "bg-gray-50" : "bg-white",
              top === 36 && index === 2 && "border-2 border-brand-500",
            )}
            key={`${String(top)}-${String(left)}`}
            style={{ left, top, width: widths[index] }}
          >
            {index === 0 && (
              <div className="absolute top-[4.5px] left-0.75 h-0.5 w-3.5 rounded-[1px] bg-gray-600 opacity-30" />
            )}
          </div>
        )),
      )}
    </Card>
  );
}

function Chart() {
  const bars: [left: number, top: number, height: number, faint: boolean][] = [
    [8, 50.36, 17.64, true],
    [23.2, 41.12, 26.88, true],
    [38.4, 47, 21, true],
    [53.6, 29.36, 38.64, false],
    [68.8, 37.76, 30.24, true],
  ];
  return (
    <Card className="h-18 w-22">
      <Bar className="top-2 left-2 h-1 w-[38.9px] bg-gray-300" />
      <Bar className="top-3.75 left-2 h-0.75 w-[24.5px] bg-gray-200" />
      {bars.map(([left, top, height, faint]) => (
        <div
          className={cn(
            "absolute w-[11.2px] bg-brand-500",
            faint && "opacity-30",
          )}
          key={left}
          style={{ height, left, top }}
        />
      ))}
      <div className="absolute top-17 left-2 h-px w-18 bg-black/5" />
    </Card>
  );
}
