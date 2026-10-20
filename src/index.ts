import { ROOT_CONTEXT, metrics, trace } from "@opentelemetry/api";
import { createMetrics } from "./metrics.js";
import { createPropagation } from "./propagation.js";
import { createParent, type Runtime } from "./span.js";
import type { OtelTelemetryContext, OtelTelemetryOptions } from "./types.js";

export const DEFAULT_SCOPE_NAME = "@aantenore/pi-otel";

/**
 * Creates a telemetry context backed by OpenTelemetry. Tracer, meter and propagator default to
 * the `@opentelemetry/api` globals; the parent is always passed explicitly (no ambient context).
 */
export function createOtelTelemetry(options: OtelTelemetryOptions = {}): OtelTelemetryContext {
  const scope = options.tracerName ?? DEFAULT_SCOPE_NAME;
  const root = options.root ?? ROOT_CONTEXT;
  const runtime: Runtime = {
    tracer: options.tracer ?? trace.getTracer(scope),
    genAi: options.genAi ?? false,
  };
  runtime.metrics = createMetrics(() => options.meter ?? metrics.getMeter(scope));
  runtime.propagation = createPropagation(runtime, root, options.propagator);
  return createParent(runtime, root) as OtelTelemetryContext;
}

export { GENAI_RULES, genAiAttributes } from "./genai.js";
export type { GenAiMapping, GenAiSpanRule } from "./genai.js";
export type {
  InstrumentOptions,
  OtelSpanOptions,
  OtelTelemetryContext,
  OtelTelemetryOptions,
  OtelTelemetryParent,
  OtelTelemetrySpan,
  TelemetryCounter,
  TelemetryHistogram,
  TelemetryLink,
  TelemetryMetrics,
  TelemetryPropagation,
} from "./types.js";
