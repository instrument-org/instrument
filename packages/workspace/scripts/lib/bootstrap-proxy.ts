import { ProxyAgent, setGlobalDispatcher } from "undici";

// cspell:ignore proxyman
// Opt-in HTTP/HTTPS proxy bootstrap so tools like Proxyman can capture
// outbound requests from this script. Set GLOBAL_AGENT_HTTP_PROXY
// (e.g. http://127.0.0.1:9090) to enable; without it this is a no-op.
//
// Patches undici's global dispatcher so global fetch (used by the AI SDK and
// other modern HTTP clients) flows through the proxy. requestTls disables
// cert verification so self-signed proxy CAs (e.g. Proxyman) work without
// installing the cert.
const proxyUrl = process.env.GLOBAL_AGENT_HTTP_PROXY;
if (proxyUrl) {
  setGlobalDispatcher(
    new ProxyAgent({
      requestTls: { rejectUnauthorized: false },
      uri: proxyUrl,
    }),
  );
  // eslint-disable-next-line no-console
  console.log(
    `Proxy bootstrap enabled via ${proxyUrl} (TLS verification disabled)`,
  );
}
