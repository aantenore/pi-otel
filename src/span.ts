import {
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
  type SpanContext,
  type Tracer,
} from "@opentelemetry/api";
import type { SpanAttributes, SpanStatus } from "@earendil-works/pi-telemetry";
import { toOtelAttributes } from "./attributes.js";
import { genAiAttributes } from "./genai.js";
import type { OtelSpanOptions, OtelTelemetryParent, OtelTelemetrySpan, TelemetryLink } from "./types.js";

export interface Runtime {
  tracer: Tracer;
  genAi: boolean;
}

/** Maps every context/span object handed out by this adapter to its OpenTelemetry context. */
const contexts = new WeakMap<object, Context>();

export function otelContextOf(value: object): Context | undefined {
  return contexts.get(value);
}

type Outcome = { ok: true } | { ok: false; error: unknown };
type ErrorInfo = { name: string; message: string };

const FALLBACK_ERROR: ErrorInfo = { name: "Error", message: "" };

function describeError(value: unknown): ErrorInfo {
  try {
    if (typeof value === "string") return { name: "Error", message: value };
    if (typeof value === "object" && value !== null) {
      const { name, message } = value as { name?: unknown; message?: unknown };
      return {
        name: typeof name === "string" && name !== "" ? name : "Error",
        message: typeof message === "string" ? message : "",
      };
    }
  } catch {
    // unreadable value: fall through
  }
  return FALLBACK_ERROR;
}

function resolveSpanContext(link: TelemetryLink): SpanContext | undefined {
  const parent = contexts.get(link.context);
  return parent ? trace.getSpanContext(parent) : undefined;
}

const INERT_SPAN: OtelTelemetrySpan = Object.freeze({
  startSpan: runInert,
  addEvent: () => {},
  setAttributes: () => {},
  setStatus: () => {},
  addLink: () => {},
});

function runInert<T>(_options: unknown, callback: (span: OtelTelemetrySpan) => T | Promise<T>): Promise<T> {
  try {
    return Promise.resolve(callback(INERT_SPAN));
  } catch (error) {
    return Promise.reject(error);
  }
}

class SpanHandle implements OtelTelemetrySpan {
  private settled = false;
  private explicit: SpanStatus | undefined;

  constructor(
    private readonly runtime: Runtime,
    private readonly name: string,
    private readonly span: Span | undefined,
    private readonly context: Context,
  ) {
    contexts.set(this, context);
  }

  startSpan<T>(options: OtelSpanOptions, callback: (span: OtelTelemetrySpan) => T | Promise<T>): Promise<T> {
    if (this.settled) return runInert(options, callback);
    return startChildSpan(this.runtime, this.context, options, callback);
  }

  setAttributes(attributes: SpanAttributes): void {
    if (this.settled || !this.span) return;
    try {
      const converted = toOtelAttributes(attributes);
      const extra = this.runtime.genAi ? genAiAttributes(this.name, converted, false) : {};
      this.span.setAttributes({ ...converted, ...extra });
    } catch {
      // passive: a failed recording call is ignored
    }
  }

  addEvent(name: string, attributes?: SpanAttributes): void {
    if (this.settled || !this.span) return;
    try {
      if (typeof name !== "string") return;
      this.span.addEvent(name, toOtelAttributes(attributes));
    } catch {
      // passive
    }
  }

  addLink(link: TelemetryLink): void {
    if (this.settled || !this.span) return;
    try {
      const context = resolveSpanContext(link);
      if (context) this.span.addLink({ context, attributes: toOtelAttributes(link.attributes) });
    } catch {
      // passive
    }
  }

  /** Stored and applied once at settlement so the last write wins (the SDK freezes status after OK). */
  setStatus(status: SpanStatus): void {
    if (this.settled || !this.span) return;
    try {
      if (status.status === "ok") {
        this.explicit = { status: "ok" };
      } else if (status.status === "error") {
        const error = status.error;
        this.explicit = error
          ? { status: "error", error: { name: String(error.name), message: String(error.message) } }
          : { status: "error" };
      }
    } catch {
      // passive
    }
  }

  settle(outcome: Outcome): void {
    if (this.settled) return;
    this.settled = true;
    const span = this.span;
    if (!span) return;
    if (!outcome.ok) {
      try {
        const error = outcome.error;
        span.recordException(error instanceof Error ? error : describeError(error));
      } catch {
        // passive
      }
    }
    try {
      const status: SpanStatus | undefined =
        this.explicit ??
        (outcome.ok ? undefined : { status: "error", error: describeError(outcome.error) });
      if (status?.status === "ok") {
        span.setStatus({ code: SpanStatusCode.OK });
      } else if (status?.status === "error") {
        span.setStatus({ code: SpanStatusCode.ERROR, message: status.error?.message });
        if (status.error) span.setAttribute("error.type", status.error.name);
      }
    } catch {
      // passive
    }
    try {
      span.end();
    } catch {
      // passive
    }
  }
}

/** Creates the OTel span (best effort) and runs the callback exactly once, synchronously. */
export function startChildSpan<T>(
  runtime: Runtime,
  parent: Context,
  options: OtelSpanOptions,
  callback: (span: OtelTelemetrySpan) => T | Promise<T>,
): Promise<T> {
  let handle: SpanHandle | undefined;
  try {
    const name = options.name;
    if (typeof name !== "string") throw new TypeError("span name must be a string");
    const attributes: Attributes = toOtelAttributes(options.attributes);
    Object.assign(attributes, runtime.genAi ? genAiAttributes(name, attributes, true) : {});
    const links = [];
    for (const link of options.links ?? []) {
      try {
        const context = resolveSpanContext(link);
        if (context) links.push({ context, attributes: toOtelAttributes(link.attributes) });
      } catch {
        // an unresolvable link is skipped
      }
    }
    const span = runtime.tracer.startSpan(name, { attributes, links }, parent);
    handle = new SpanHandle(runtime, name, span, trace.setSpan(parent, span));
  } catch {
    // span creation failed: business code still runs, without recording
  }

  if (!handle) return runInert(options, callback);
  const active = handle;
  let result: T | Promise<T>;
  try {
    result = callback(active);
  } catch (error) {
    active.settle({ ok: false, error });
    return Promise.reject(error);
  }
  return Promise.resolve(result).then(
    (value) => {
      active.settle({ ok: true });
      return value;
    },
    (error: unknown) => {
      active.settle({ ok: false, error });
      throw error;
    },
  );
}

/** A context that starts spans under `parent`; used for the root and for extracted remote contexts. */
export function createParent(runtime: Runtime, parent: Context): OtelTelemetryParent {
  const context: OtelTelemetryParent = {
    startSpan: (options, callback) => startChildSpan(runtime, parent, options, callback),
  };
  contexts.set(context, parent);
  return context;
}
