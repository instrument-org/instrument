import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping";
import type { WebContents } from "electron";

type Method = keyof ProtocolMapping.Commands;
type Params<M extends Method> = ProtocolMapping.Commands[M]["paramsType"];
type Return<M extends Method> = ProtocolMapping.Commands[M]["returnType"];

// CDP commands declare paramsType as a (possibly empty) tuple where the only
// element may be optional. Map that to overloaded call signatures so callers
// either omit params (no-arg or all-optional commands) or pass a typed object.
type SendArgs<M extends Method> =
  Params<M> extends []
    ? []
    : Params<M> extends [infer P]
      ? [params: P]
      : Params<M> extends [(infer P)?]
        ? [params?: P]
        : never;

export async function sendCdpCommand<M extends Method>(
  wc: WebContents,
  method: M,
  ...args: SendArgs<M>
): Promise<Return<M>> {
  // Electron's debugger.sendCommand types params as `any` and returns `any`.
  // The mapping above is the source of truth; cast at the boundary only.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return await wc.debugger.sendCommand(method, args[0]);
}
