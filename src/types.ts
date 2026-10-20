import type { Context, Meter, TextMapPropagator, Tracer } from "@opentelemetry/api";
import type {
  SpanAttributes,
  SpanOptions,
  TelemetryContext,
  TelemetrySpan,
} from "@earendil-works/pi-telemetry";

/** Reference to another span, resolvable only when it was produced by this adapter or `extract`. */
export interface TelemetryLink {
  context: TelemetryContext;
  attributes?: SpanAttributes;
}

/** Extension of the contract's span options. */
export interface OtelSpanOptions extends SpanOptions {
  links?: readonly TelemetryLink[];
}

export interface InstrumentOptions {
  unit?: string;
  description?: string;
}

export interface TelemetryCounter {
  add(value: number, attributes?: SpanAttributes): void;
}

export interface TelemetryHistogram {
  record(value: number, attributes?: SpanAttributes): void;
}

export interface TelemetryMetrics {
  counter(name: string, options?: InstrumentOptions): TelemetryCounter;
  upDownCounter(name: string, options?: InstrumentOptions): TelemetryCounter;
  histogram(name: string, options?: InstrumentOptions): TelemetryHistogram;
}

export interface TelemetryPropagation {
  /** Serializes the position of `context` (a span or context created by this adapter) into a carrier. */
  inject(context: TelemetryContext): Record<string, string>;
  /** Returns a context whose children continue the remote trace described by `carrier`. */
  extract(carrier: Record<string, string>): OtelTelemetryParent;
}

/** A `TelemetryContext` whose `startSpan` also accepts links. */
export interface OtelTelemetryParent extends TelemetryContext {
  startSpan<T>(options: OtelSpanOptions, callback: (span: OtelTelemetrySpan) => T | Promise<T>): Promise<T>;
}

/** `TelemetryContext` plus the optional metrics and propagation extensions. */
export interface OtelTelemetryContext extends OtelTelemetryParent {
  readonly metrics: TelemetryMetrics;
  readonly propagation: TelemetryPropagation;
}

export interface OtelTelemetrySpan extends TelemetrySpan {
  addLink(link: TelemetryLink): void;
  startSpan<T>(options: OtelSpanOptions, callback: (span: OtelTelemetrySpan) => T | Promise<T>): Promise<T>;
}

export interface OtelTelemetryOptions {
  tracer?: Tracer;
  meter?: Meter;
  propagator?: TextMapPropagator;
  /** Instrumentation scope name used when `tracer` is not supplied. */
  tracerName?: string;
  /** Add OpenTelemetry GenAI semantic-convention attributes next to the original ones. */
  genAi?: boolean;
  /** Parent of top-level spans. Defaults to `ROOT_CONTEXT`. */
  root?: Context;
}
