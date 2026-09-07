/**
 * `fetch`, with its result made an instance of whatever the global `Response`
 * is at the time.
 *
 * The workspace server puts @hono/node-server's lightweight Response on the
 * global (its proxy helper depends on the matching Request, so the override
 * stays), while Node's fetch keeps returning undici's. So in this process a
 * fetched response fails `instanceof Response`. The MCP SDK reads an error
 * body only after that check and otherwise stringifies the object, which is
 * how a service's 403 at client registration came back as "[object Response]"
 * with the status and the body gone. Wrapping the result in the global class
 * costs nothing where the two already agree.
 */
export const fetchForMcp: typeof fetch = async (input, init) => {
  // Typed as unknown because the types say fetch returns the global Response
  // and it does not: the value is a Response of another class.
  const response: unknown = await fetch(input, init);
  if (response instanceof Response) {
    return response;
  }
  const foreign = response as Response;
  return new Response(foreign.body, foreign);
};
