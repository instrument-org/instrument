import appIconStylizedSrc from "@/client/assets/app-icon-stylized.png";

interface AppIconStylizedProps {
  className?: string;
  size?: number | string;
}

export function AppIconStylized({ className, size }: AppIconStylizedProps) {
  return (
    <img
      alt=""
      aria-hidden
      className={className}
      draggable={false}
      height={size}
      src={appIconStylizedSrc}
      width={size}
    />
  );
}
