import { SpanStatusCode } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import type { RecordedTelemetrySpan } from "@earendil-works/pi-telemetry";
import { createOtelTelemetry, type OtelTelemetryContext, type OtelTelemetryOptions } from "../src/index.js";

export interface Harness {
  telemetry: OtelTelemetryContext;
  exporter: InMemorySpanExporter;
  spans(): ReadableSpan[];
  byName(name: string): ReadableSpan;
  shutdown(): Promise<void>;
}

export function createHarness(options: OtelTelemetryOptions = {}): Harness {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const telemetry = createOtelTelemetry({
    tracer: provider.getTracer("test"),
    propagator: new W3CTraceContextPropagator(),
    ...options,
  });
  return {
    telemetry,
    exporter,
    spans: () => exporter.getFinishedSpans(),
    byName(name) {
      const span = exporter.getFinishedSpans().find((candidate) => candidate.name === name);
      if (!span) throw new Error(`span not found: ${name}`);
      return span;
    },
    shutdown: () => provider.shutdown(),
  };
}

export function createMetricsHarness() {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 });
  const provider = new MeterProvider({ readers: [reader] });
  const telemetry = createOtelTelemetry({ meter: provider.getMeter("test") });
  return {
    telemetry,
    async collect() {
      await reader.forceFlush();
      return exporter
        .getMetrics()
        .flatMap((resource) => resource.scopeMetrics)
        .flatMap((scope) => scope.metrics);
    },
    shutdown: () => provider.shutdown(),
  };
}

const hrToNanos = (time: [number, number]) => BigInt(time[0]) * 1_000_000_000n + BigInt(time[1]);

/** Converts finished OTel spans to the normalized snapshots used by the conformance suite. */
export function normalizeSpans(finished: readonly ReadableSpan[]): RecordedTelemetrySpan[] {
  const byStart = finished
    .map((span, endIndex) => ({ span, endIndex }))
    .sort((a, b) => {
      const delta = hrToNanos(a.span.startTime) - hrToNanos(b.span.startTime);
      return delta < 0n ? -1 : delta > 0n ? 1 : a.endIndex - b.endIndex;
    });
  const ids = new Map(byStart.map(({ span }, index) => [span.spanContext().spanId, index + 1]));
  return byStart.map(({ span, endIndex }) => {
    const parentSpanId = span.parentSpanContext?.spanId;
    const errorName = span.attributes["error.type"];
    const status: RecordedTelemetrySpan["status"] =
      span.status.code === SpanStatusCode.ERROR
        ? {
            status: "error",
            ...(errorName !== undefined || span.status.message
              ? { error: { name: String(errorName ?? "Error"), message: span.status.message ?? "" } }
              : {}),
          }
        : { status: "ok" };
    return {
      id: ids.get(span.spanContext().spanId) ?? 0,
      parentId: (parentSpanId && ids.get(parentSpanId)) || null,
      name: span.name,
      attributes: { ...span.attributes } as RecordedTelemetrySpan["attributes"],
      events: span.events.map((event) => ({
        name: event.name,
        attributes: { ...event.attributes } as RecordedTelemetrySpan["attributes"],
      })),
      status,
      settled: true,
      endSequence: endIndex,
    };
  });
}
