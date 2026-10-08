import {
  SetupHead,
  SetupPage,
  SetupQuietLink,
} from "@/client/components/onboarding/setup/chrome";
import { useSetup } from "@/client/components/onboarding/setup/context";
import { type SetupStep } from "@/client/components/onboarding/setup/flow";

/**
 * A page not drawn yet: its title and a way on, so the flow can be walked end
 * to end while pages are built.
 */
export function PlaceholderPage({
  links = [],
  next,
  title,
}: {
  links?: { label: string; step: SetupStep }[];
  next?: SetupStep;
  title: string;
}) {
  const { dispatch } = useSetup();
  return (
    <SetupPage
      next={
        next
          ? {
              label: "Continue",
              onClick: () => {
                dispatch({ step: next, type: "go" });
              },
            }
          : undefined
      }
    >
      <SetupHead subtitle="This page is still a placeholder." title={title} />
      <div className="mt-6 flex flex-col items-center gap-3">
        {links.map((link) => (
          <SetupQuietLink
            key={link.step}
            onClick={() => {
              dispatch({ step: link.step, type: "go" });
            }}
          >
            {link.label}
          </SetupQuietLink>
        ))}
      </div>
    </SetupPage>
  );
}
