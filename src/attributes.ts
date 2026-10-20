import type { Attributes } from "@opentelemetry/api";
import type { SpanAttributes } from "@earendil-works/pi-telemetry";

function convertValue(value: unknown): Attributes[string] {
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "object":
      if (Array.isArray(value)) {
        const copy: unknown[] = Array.from(value);
        if (copy.every((item) => typeof item === "string")) return copy as string[];
        if (copy.every((item) => typeof item === "number")) return copy as number[];
        if (copy.every((item) => typeof item === "boolean")) return copy as boolean[];
      }
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Converts a contract attribute bag to OpenTelemetry attributes.
 * Undefined and unsupported values are dropped; arrays are copied. May throw if the
 * input is unreadable, so callers apply the result only after conversion succeeded.
 */
export function toOtelAttributes(attributes: SpanAttributes | undefined): Attributes {
  const result: Attributes = {};
  if (attributes === undefined) return result;
  for (const key of Object.keys(attributes)) {
    const value = convertValue(attributes[key]);
    if (value !== undefined) result[key] = value;
  }
  return result;
}
