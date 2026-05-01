import { useId } from "react";

export function MacFolderIcon({ className }: { className?: string }) {
  const id = useId().replaceAll(":", "");
  const tabGradientId = `${id}-mac-folder-tab`;
  const bodyGradientId = `${id}-mac-folder-body`;

  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 51 51"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M16.2723 0C18.9267 0 21.2442 1.80581 21.8885 4.38071L22.721 7.71429H44.3571C47.5524 7.71429 50.1429 10.3046 50.1429 13.5V44.3571C50.1429 47.5524 47.5524 50.1429 44.3571 50.1429H5.78571C2.59034 50.1429 0 47.5524 0 44.3571V5.78571C0 2.59034 2.59034 0 5.78571 0H16.2723Z"
        fill={`url(#${tabGradientId})`}
      />
      <path
        d="M44.3571 17.3571H5.78571C2.59034 17.3571 0 19.9475 0 23.1429V44.3571C0 47.5524 2.59034 50.1429 5.78571 50.1429H44.3571C47.5524 50.1429 50.1429 47.5524 50.1429 44.3571V23.1429C50.1429 19.9475 47.5524 17.3571 44.3571 17.3571Z"
        fill={`url(#${bodyGradientId})`}
      />
      <defs>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id={tabGradientId}
          x1="25.0714"
          x2="25.0714"
          y1="0"
          y2="29.5703"
        >
          <stop stopColor="#2E90FA" />
          <stop offset="1" stopColor="#175CD3" />
        </linearGradient>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id={bodyGradientId}
          x1="25.0714"
          x2="25.0714"
          y1="17.3571"
          y2="50.1429"
        >
          <stop stopColor="#84CAFF" />
          <stop offset="1" stopColor="#53B1FD" />
        </linearGradient>
      </defs>
    </svg>
  );
}
