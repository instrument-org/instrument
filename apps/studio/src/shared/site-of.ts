/** The host a site goes by, with and without `www.` being one site. */
export function siteOf(host: string): string {
  return host.replace(/^www\.(?=.+\.)/, "");
}
