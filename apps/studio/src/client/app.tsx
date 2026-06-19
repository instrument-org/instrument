import { queryClient, router } from "@/client/router";
import { IconContext, type IconProps } from "@phosphor-icons/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

const IconContextValue: IconProps = {
  weight: "bold",
};

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <IconContext.Provider value={IconContextValue}>
        <RouterProvider router={router} />
      </IconContext.Provider>
    </QueryClientProvider>
  );
}
