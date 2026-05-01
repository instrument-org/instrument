import { ThemeProvider } from "@/client/components/theme-provider";
import { queryClient, router } from "@/client/router";
import { IconContext, type IconProps } from "@phosphor-icons/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import { TelemetryProvider } from "./providers/telemetry";

const IconContextValue: IconProps = {
  weight: "bold",
};

export function App() {
  return (
    <TelemetryProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <IconContext.Provider value={IconContextValue}>
            <RouterProvider router={router} />
          </IconContext.Provider>
        </ThemeProvider>
      </QueryClientProvider>
    </TelemetryProvider>
  );
}
