/** Keep route/host information without credentials, queries or owner project
 * names. Fio credentials are path segments, so query stripping alone is unsafe. */
export function redactTelemetryUrl(raw: string): string {
  const relative = raw.startsWith("/") && !raw.startsWith("//");
  try {
    const url = new URL(raw, relative ? "https://telemetry.invalid" : undefined);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "[filtered-url]";
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    if (url.hostname === "fioapi.fio.cz") url.pathname = "/v1/rest/[filtered]";
    else url.pathname = url.pathname.replace(/(\/projects\/)[^/]+/g, "$1[project]")
      .replace(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi, "[id]");
    return relative ? url.pathname : `${url.origin}${url.pathname}`;
  } catch { return "[filtered-url]"; }
}

export function redactTelemetryText(text: string): string {
  if (text.startsWith("/") && !/\s/.test(text)) return redactTelemetryUrl(text);
  const paths = text.replace(/\/v1\/rest\/[^\s<>"'()]+/gi, "/v1/rest/[filtered]");
  return paths.replace(/https?:\/\/[^\s<>"'()]+/gi, redactTelemetryUrl);
}
