import { ExternalLink } from "@/client/components/external-link";

const S = {
  link: "inline-flex items-center gap-x-0.5 text-muted-foreground hover:text-foreground underline decoration-solid [text-decoration-skip-ink:none] [text-underline-position:from-font]",
} as const;

export function ProviderLinks({
  keyURL,
  name,
  url,
}: {
  keyURL?: string;
  name: string;
  url: string;
}) {
  return (
    <div className="text-xs text-muted-foreground">
      {keyURL ? (
        <>
          <span>
            <ExternalLink className={S.link} href={keyURL}>
              Get an API key
            </ExternalLink>
          </span>{" "}
          <span>or</span>{" "}
          <span>
            <ExternalLink className={S.link} href={url}>
              learn more
            </ExternalLink>{" "}
            about {name}.
          </span>
        </>
      ) : (
        <span>
          <ExternalLink className={S.link} href={url}>
            Learn more
          </ExternalLink>{" "}
          about {name}.
        </span>
      )}
    </div>
  );
}
