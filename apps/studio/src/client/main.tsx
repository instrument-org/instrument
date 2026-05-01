import { ThemeProvider } from "@/client/components/theme-provider";
import { queryClient, router } from "@/client/router";
import { IconContext, type IconProps } from "@phosphor-icons/react";

import "./styles/app.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import { TelemetryProvider } from "./providers/telemetry";

const IconContextValue: IconProps = {
  weight: "bold",
};

export function Main() {
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

const rootElement = document.querySelector("#root");

if (rootElement && rootElement.innerHTML === "") {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<Main />);
}
