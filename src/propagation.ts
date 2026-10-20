import {
  defaultTextMapGetter,
  defaultTextMapSetter,
  propagation,
  type Context,
  type TextMapPropagator,
} from "@opentelemetry/api";
import { createParent, otelContextOf, type Runtime } from "./span.js";
import type { TelemetryPropagation } from "./types.js";

export function createPropagation(
  runtime: Runtime,
  root: Context,
  propagator: TextMapPropagator | undefined,
): TelemetryPropagation {
  return {
    inject(context) {
      const carrier: Record<string, string> = {};
      try {
        const otelContext = otelContextOf(context) ?? root;
        if (propagator) propagator.inject(otelContext, carrier, defaultTextMapSetter);
        else propagation.inject(otelContext, carrier, defaultTextMapSetter);
      } catch {
        // passive
      }
      return carrier;
    },
    extract(carrier) {
      let extracted = root;
      try {
        extracted = propagator
          ? propagator.extract(root, carrier, defaultTextMapGetter)
          : propagation.extract(root, carrier, defaultTextMapGetter);
      } catch {
        // passive: fall back to the root context
      }
      return createParent(runtime, extracted);
    },
  };
}
