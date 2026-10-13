import { pinnedSourceFetch } from "./pinned-fetch";
import dns from "node:dns/promises";
import net from "node:net";

const ALLOWED_CONTENT_TYPES = [
  "application/atom+xml",
  "application/feed+json",
  "application/json",
  "application/rss+xml",
  "application/xml",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
  "text/html",
  "text/plain",
  "text/xml"
];

export class UnsafeUrlError extends Error {}
export class SourceHttpError extends Error { constructor(readonly status: number) { super("source-http-failed"); } }

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [a = -1, b = -1] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    !/^[23][0-9a-f]{0,3}:/i.test(normalized) ||
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    return !isPrivateIpv4(address);
  }
  if (family === 6) {
    return !isPrivateIpv6(address);
  }
  return false;
}

export function parseSafeHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("URL is invalid");
  }
  if (url.protocol !== "https:") {
    throw new UnsafeUrlError("Only HTTPS URLs are allowed");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("Credentials in URLs are forbidden");
  }
  if (
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.endsWith(".local") ||
    url.hostname === "metadata.google.internal"
  ) {
    throw new UnsafeUrlError("Local and metadata hosts are forbidden");
  }
  const literalHost = url.hostname.replace(/^\[|\]$/g, "");
  if (url.port && url.port !== "443") throw new UnsafeUrlError("Nonstandard source port is forbidden");
  if (net.isIP(literalHost) && !isPublicAddress(literalHost)) {
    throw new UnsafeUrlError("Private address is forbidden");
  }
  return url;
}

export async function resolvePublicAddresses(hostname: string): Promise<string[]> {
  if (net.isIP(hostname)) {
    return [hostname];
  }
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  const addresses = records.map((record) => record.address);
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
    throw new UnsafeUrlError("Host resolves to a private or missing address");
  }
  return addresses;
}

export interface SafeFetchOptions {
  allowHosts: readonly string[];
  /**
   * HEAD reads status and headers only. It carries no body, and like POST it refuses a redirect
   * instead of following one: a pinned asset URL that redirects is not the URL that was checked.
   */
  method?: "GET" | "POST" | "HEAD";
  headers?: Readonly<Record<string, string>>;
  body?: string;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  resolveImpl?: (hostname: string) => Promise<string[]>;
  responseHeaderNames?: readonly string[];
  acceptedStatuses?: readonly number[];
  /**
   * Media types this one call accepts beyond the shared list. Narrow on purpose: an iCalendar
   * export is `text/calendar`, and widening the global list would let every feed reader take it.
   */
  extraContentTypes?: readonly string[];
}

export async function safeFetch(
  raw: string,
  options: SafeFetchOptions
): Promise<{ url: string; status: number; contentType: string; body: Uint8Array; headers: Record<string, string> }> {
  const fetchImpl = options.fetchImpl;
  const resolveImpl = options.resolveImpl ?? resolvePublicAddresses;
  const maxRedirects = options.maxRedirects ?? 3;
  const maxBytes = options.maxBytes ?? 1_000_000;
  let url = parseSafeHttpsUrl(raw);
  const method = options.method ?? "GET";

  if ((method === "GET" || method === "HEAD") && options.body !== undefined) {
    throw new UnsafeUrlError(`${method} requests cannot include a body`);
  }
  for (const name of Object.keys(options.headers ?? {})) {
    if (["cookie", "host", "proxy-authorization", "forwarded"].includes(name.toLowerCase())) {
      throw new UnsafeUrlError(`Forbidden request header: ${name}`);
    }
  }
  if ((options.responseHeaderNames?.length ?? 0) > 20) {
    throw new UnsafeUrlError("Too many response headers requested");
  }
  for (const name of options.responseHeaderNames ?? []) {
    if (!/^[a-z0-9-]+$/i.test(name) || ["set-cookie", "set-cookie2", "www-authenticate", "proxy-authenticate"].includes(name.toLowerCase())) {
      throw new UnsafeUrlError(`Forbidden response header: ${name}`);
    }
  }

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    if (!options.allowHosts.includes(url.hostname)) {
      throw new UnsafeUrlError(`Host is not allowlisted: ${url.hostname}`);
    }
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("Source request timed out")), options.timeoutMs ?? 8_000);
    let response: Response | undefined;
    try {
      controller.signal.throwIfAborted();
      const addresses = await abortable(resolveImpl(url.hostname), controller.signal);
      if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
        throw new UnsafeUrlError("DNS resolution includes a private or missing address");
      }
      controller.signal.throwIfAborted();
      response = await abortable((fetchImpl ?? ((input, init) => pinnedSourceFetch(input, init, addresses)))(url, {
        headers: {
          Accept: [
            ...(options.extraContentTypes ?? []),
            "application/json, application/atom+xml, application/rss+xml, application/xml, text/plain;q=0.9, text/html;q=0.7"
          ].join(", "),
          ...options.headers
        },
        method,
        body: options.body,
        redirect: "manual",
        signal: controller.signal
      }), controller.signal);
      const explicitlyAccepted = options.acceptedStatuses?.includes(response.status) ?? false;
      if (response.status >= 300 && response.status < 400 && !explicitlyAccepted) {
        if (method !== "GET") {
          throw new UnsafeUrlError("Redirects are forbidden for non-GET requests");
        }
        const location = response.headers.get("location");
        if (!location || redirect === maxRedirects) {
          throw new UnsafeUrlError("Unsafe or excessive redirect");
        }
        url = parseSafeHttpsUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok && !explicitlyAccepted) {
        throw new SourceHttpError(response.status);
      }
      const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
      if (response.ok && !ALLOWED_CONTENT_TYPES.includes(contentType) && !(options.extraContentTypes ?? []).includes(contentType)) {
        throw new UnsafeUrlError(`Unexpected content type: ${contentType}`);
      }
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > maxBytes) {
        throw new UnsafeUrlError("Declared response is too large");
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = response.body?.getReader();
      try {
        if (method !== "HEAD" && reader) {
          while (true) {
            const chunk = await abortable(reader.read(), controller.signal);
            if (chunk.done) break;
            total += chunk.value.byteLength;
            if (total > maxBytes) throw new UnsafeUrlError("Decompressed response is too large");
            chunks.push(chunk.value);
          }
        }
      } finally {
        // Cancellation is intentionally not awaited: an untrusted stream may never acknowledge it.
        void reader?.cancel().catch(() => undefined);
        reader?.releaseLock();
      }
      const buffer = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
      const headers: Record<string, string> = {};
      for (const requestedName of options.responseHeaderNames ?? []) {
        const value = response.headers.get(requestedName);
        if (value !== null) headers[requestedName.toLowerCase()] = value.slice(0, 256);
      }
      return { url: url.toString(), status: response.status, contentType, body: buffer, headers };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined);
    }
  }
  throw new UnsafeUrlError("Redirect limit exceeded");
}

/** Bound DNS, headers and streamed body to the same deadline, including non-cooperating mocks. */
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Source request aborted"));
    signal.addEventListener("abort", abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}
