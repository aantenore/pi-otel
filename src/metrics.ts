import type { Meter } from "@opentelemetry/api";
import type { SpanAttributes } from "@earendil-works/pi-telemetry";
import { toOtelAttributes } from "./attributes.js";
import type {
  InstrumentOptions,
  TelemetryCounter,
  TelemetryHistogram,
  TelemetryMetrics,
} from "./types.js";

type Recorder = (value: number, attributes?: SpanAttributes) => void;

/** Instruments are created lazily per name and cached; every call is passive (never throws). */
export function createMetrics(getMeter: () => Meter): TelemetryMetrics {
  const counters = new Map<string, TelemetryCounter>();
  const upDownCounters = new Map<string, TelemetryCounter>();
  const histograms = new Map<string, TelemetryHistogram>();

  const cached = <I>(cache: Map<string, I>, name: string, create: () => I): I => {
    let instrument = cache.get(name);
    if (!instrument) {
      instrument = create();
      cache.set(name, instrument);
    }
    return instrument;
  };

  const recorder = (make: () => (value: number, attributes: ReturnType<typeof toOtelAttributes>) => void): Recorder => {
    let target: ReturnType<typeof make> | undefined;
    return (value, attributes) => {
      try {
        target ??= make();
        target(value, toOtelAttributes(attributes));
      } catch {
        // passive
      }
    };
  };

  const settings = (options?: InstrumentOptions) => ({ unit: options?.unit, description: options?.description });

  return {
    counter: (name, options) =>
      cached(counters, name, () => {
        const add = recorder(() => {
          const instrument = getMeter().createCounter(name, settings(options));
          return (value, attributes) => instrument.add(value, attributes);
        });
        return { add };
      }),
    upDownCounter: (name, options) =>
      cached(upDownCounters, name, () => {
        const add = recorder(() => {
          const instrument = getMeter().createUpDownCounter(name, settings(options));
          return (value, attributes) => instrument.add(value, attributes);
        });
        return { add };
      }),
    histogram: (name, options) =>
      cached(histograms, name, () => {
        const record = recorder(() => {
          const instrument = getMeter().createHistogram(name, settings(options));
          return (value, attributes) => instrument.record(value, attributes);
        });
        return { record };
      }),
  };
}
