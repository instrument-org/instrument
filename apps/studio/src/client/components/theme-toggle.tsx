import { useTheme } from "@/client/components/theme-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/client/components/ui/select";
import { MonitorIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";

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
    <Select
      onValueChange={(value) => {
        if (value === "light" || value === "dark" || value === "system") {
          setTheme(value);
        }
      }}
      value={theme}
    >
      <SelectTrigger
        aria-label="Theme"
        className="bg-card bg-none dark:bg-gray-700"
      >
        {getThemeIcon()}
        {getThemeName()}
      </SelectTrigger>
      <SelectContent align="end" position="popper">
        <SelectItem value="light">
          <SunIcon className="size-4" />
          Light
        </SelectItem>
        <SelectItem value="dark">
          <MoonIcon className="size-4" />
          Dark
        </SelectItem>
        <SelectItem value="system">
          <MonitorIcon className="size-4" />
          System
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
