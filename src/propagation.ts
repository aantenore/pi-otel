import {
  defaultTextMapGetter,
  defaultTextMapSetter,
  diag,
  propagation,
  type Context,
  type TextMapPropagator,
} from "@opentelemetry/api";
import { createParent, otelContextOf, type Runtime } from "./span.js";
import type { TelemetryPropagation } from "./types.js";

let warnedNoPropagator = false;

/** Warns once when the global propagator is the no-op default, since inject/extract would do nothing. */
function warnIfNoGlobalPropagator(): void {
  if (warnedNoPropagator || propagation.fields().length > 0) return;
  warnedNoPropagator = true;
  diag.warn(
    "@aantenore/pi-otel: no propagator is registered, so propagation.inject/extract are no-ops. " +
      "Register one (e.g. propagation.setGlobalPropagator(new W3CTraceContextPropagator())) or pass the `propagator` option.",
  );
}

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
        if (propagator) {
          propagator.inject(otelContext, carrier, defaultTextMapSetter);
        } else {
          warnIfNoGlobalPropagator();
          propagation.inject(otelContext, carrier, defaultTextMapSetter);
        }
      } catch {
        // passive
      }
      return carrier;
    },
    extract(carrier) {
      let extracted = root;
      try {
        if (propagator) {
          extracted = propagator.extract(root, carrier, defaultTextMapGetter);
        } else {
          warnIfNoGlobalPropagator();
          extracted = propagation.extract(root, carrier, defaultTextMapGetter);
        }
      } catch {
        // passive: fall back to the root context
      }
      return createParent(runtime, extracted);
    },
  };
}
