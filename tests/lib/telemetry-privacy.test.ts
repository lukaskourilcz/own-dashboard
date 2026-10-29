import { expect, it } from "vitest";
import { redactTelemetryText, redactTelemetryUrl } from "@/lib/telemetry-url";
import { sentryPrivacyOptions as privacy } from "@/lib/sentry-privacy";
it.each([
  ["https://fioapi.fio.cz/v1/rest/periods/synthetic-private-path/2026-10-01/2026-10-24/transactions.json", "https://fioapi.fio.cz/v1/rest/[filtered]"],
  ["https://person:synthetic-password@api.example/path?access_token=synthetic-private-query#private", "https://api.example/path"],
  ["/projects/private-customer?note=synthetic-private-query", "/projects/[project]"],
  ["https://api.example/accounts/11111111-1111-4111-8111-111111111111?key=synthetic-private-query", "https://api.example/accounts/[id]"],
  ["javascript:synthetic-private", "[filtered-url]"], ["//example.com/private", "[filtered-url]"],
])("redacts credential and record-bearing URL fields: %s", (input, expected) => expect(redactTelemetryUrl(input)).toBe(expected));
it("redacts URLs embedded in exception and span descriptions without changing technical codes", () => {
  expect(redactTelemetryText("GET https://fioapi.fio.cz/v1/rest/periods/synthetic-private-path/a/b/transactions.json failed (502)")).toBe("GET https://fioapi.fio.cz/v1/rest/[filtered] failed (502)");
  expect(redactTelemetryText("GET fioapi.fio.cz/v1/rest/periods/synthetic-private-path/a/b/transactions.json")).toBe("GET fioapi.fio.cz/v1/rest/[filtered]");
  expect(redactTelemetryText("bank-sync-failed")).toBe("bank-sync-failed");
});
it("disables SDK body, identity, query, model, database, local-variable and source-context collection", () => {
  expect(privacy.dataCollection).toEqual({ userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
    databaseQueryData: false, graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false }, stackFrameVariables: false, frameContextLines: 0 });
});
it("keeps technical error state while excluding request payloads and arbitrary extras", async () => {
  const input = { type: undefined, message: "GET https://fioapi.fio.cz/v1/rest/periods/synthetic-private-path/a/b/transactions.json failed", user: { email: "synthetic@example.invalid" },
    extra: { status: 502, record: "synthetic-private-record" }, request: { method: "POST", url: "https://app.example/auth/callback?code=synthetic-private-query", data: "synthetic-private-body", headers: { authorization: "synthetic-private-header" }, cookies: { session: "synthetic-private-cookie" } },
    exception: { values: [{ type: "Error", value: "GET https://api.example/path?token=synthetic-private-query" }] } };
  const result = await privacy.beforeSend!(input, {});
  expect(result).toMatchObject({ extra: { status: 502 }, request: { method: "POST", url: "https://app.example/auth/callback" } });
  expect(result?.user).toBeUndefined(); expect(JSON.stringify(result)).not.toContain("synthetic-private"); expect(input.request.data).toBe("synthetic-private-body");
});
it("filters span and network breadcrumb values and drops console/click content", () => {
  const span = privacy.beforeSendSpan!({ trace_id: "fixture-trace", span_id: "fixture-span", start_timestamp: 1, description: "GET https://fioapi.fio.cz/v1/rest/periods/synthetic-private-path/a/b/transactions.json", data: {
    "http.url": "https://api.example/path?token=synthetic-private-query", "http.status_code": 502, "http.request.body": "synthetic-private-body", "authorization": "synthetic-private-header", "gen_ai.input.messages": "synthetic-private-note",
  } });
  expect(span.data).toEqual({ "http.url": "https://api.example/path", "http.status_code": 502 }); expect(JSON.stringify(span)).not.toContain("synthetic-private");
  expect(privacy.beforeBreadcrumb!({ category: "console", message: "synthetic-private-note" })).toBeNull();
  expect(privacy.beforeBreadcrumb!({ category: "ui.click", message: "synthetic-private-record" })).toBeNull();
  expect(privacy.beforeBreadcrumb!({ category: "fetch", data: { url: "https://api.example/path?token=synthetic-private-query", status_code: 500 } })?.data).toEqual({ url: "https://api.example/path", status_code: 500 });
});
