import http from "node:http";

type Page = { body: string; type: string };

/**
 * Serves fixed pages on a loopback port for the life of the process, so a
 * case that only needs some page to browse or download reads one that never
 * changes or goes down. The shell's `curl` and the browser both reach
 * loopback. Returns the site's origin, `http://127.0.0.1:<port>`.
 */
export async function serveLoopbackSite(
  pages: Record<string, Page>,
): Promise<string> {
  const server = http.createServer((request, response) => {
    const page = pages[new URL(request.url ?? "/", "http://x").pathname];
    if (!page) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": page.type });
    response.end(page.body);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  const address = server.address();
  if (typeof address !== "object" || !address) {
    throw new Error("The loopback site has no port");
  }
  return `http://127.0.0.1:${address.port}`;
}
