import { useTheme } from "@/client/components/theme-provider";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  CaretDownIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from "@phosphor-icons/react";

export function ThemeToggle() {
  const { setTheme, theme } = useTheme();

  const getThemeIcon = () => {
    switch (theme) {
      case "dark": {
        return <MoonIcon className="size-4" />;
      }
      case "light": {
        return <SunIcon className="size-4" />;
      }
      case "system": {
        return <MonitorIcon className="size-4" />;
      }
      default: {
        return <SunIcon className="size-4" />;
      }
    }
  };

  const getThemeName = () => {
    switch (theme) {
      case "dark": {
        return "Dark";
      }
      case "light": {
        return "Light";
      }
      case "system": {
        return "System";
      }
      default: {
        return "Light";
      }
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="gap-2" variant="outline">
          {getThemeIcon()}
          {getThemeName()}
          <CaretDownIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => {
            setTheme("light");
          }}
        >
          <SunIcon className="mr-2 size-4" />
          Light
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setTheme("dark");
          }}
        >
          <MoonIcon className="mr-2 size-4" />
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setTheme("system");
          }}
        >
          <MonitorIcon className="mr-2 size-4" />
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
