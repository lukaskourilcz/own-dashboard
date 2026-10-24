import type { init } from "@sentry/nextjs";
import { redactTelemetryText, redactTelemetryUrl } from "@/lib/telemetry-url";

type Options = Parameters<typeof init>[0];
type Span = Parameters<NonNullable<Options["beforeSendSpan"]>>[0];
type SpanAttributes = Span["data"];
type SpanAttributeValue = SpanAttributes[string];

function redactValue(value: SpanAttributeValue | undefined): SpanAttributeValue | undefined {
  if (typeof value === "string") return redactTelemetryText(value);
  if (Array.isArray(value)) return value.map(item => typeof item === "string" ? redactTelemetryText(item) : item) as SpanAttributeValue;
  return value === undefined || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}
function redactAttributes(data: SpanAttributes): SpanAttributes {
  return Object.fromEntries(Object.entries(data)
    .filter(([key]) => !/(?:authorization|cookie|headers?|token|secret|password|(?:^|[._])(?:body|payload|params|variables|prompt|completion|input|output)(?:$|[._]))/i.test(key))
    .map(([key, value]) => [key, redactValue(value)]));
}

/** Current SDK collection categories are explicit; the deprecated PII switch
 * does not disable every payload category. No workspace/session replay. */
export const sentryPrivacyOptions: Pick<Options, "dataCollection" | "beforeSend" | "beforeSendSpan" | "beforeBreadcrumb"> = {
  dataCollection: {
    userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
    databaseQueryData: false, graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false },
    stackFrameVariables: false, frameContextLines: 0,
  },
  beforeSend(event) {
    return {
      ...event, user: undefined,
      extra: typeof event.extra?.status === "number" ? { status: event.extra.status } : undefined,
      request: event.request ? { method: event.request.method, url: event.request.url ? redactTelemetryUrl(event.request.url) : undefined } : undefined,
      message: event.message ? redactTelemetryText(event.message) : undefined,
      exception: event.exception ? { ...event.exception, values: event.exception.values?.map(value => ({
        ...value, value: value.value ? redactTelemetryText(value.value) : undefined,
      })) } : undefined,
    };
  },
  beforeSendSpan(span) {
    return { ...span, description: span.description ? redactTelemetryText(span.description) : undefined, data: redactAttributes(span.data) };
  },
  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.category?.startsWith("console") || breadcrumb.category?.startsWith("ui.")) return null;
    return { ...breadcrumb, message: breadcrumb.message ? redactTelemetryText(breadcrumb.message) : undefined,
      data: breadcrumb.data ? redactAttributes(breadcrumb.data) : undefined };
  },
};
