import { describe, expect, it } from "vitest";
import { createMetricsHarness } from "./helpers.js";

describe("metrics", () => {
  it("maps counter, upDownCounter and histogram", async () => {
    const h = createMetricsHarness();
    const { metrics } = h.telemetry;
    metrics.counter("pi.requests", { unit: "1", description: "requests" }).add(2, { provider: "x", skip: undefined });
    metrics.counter("pi.requests").add(3, { provider: "x" });
    metrics.upDownCounter("pi.inflight").add(1);
    metrics.upDownCounter("pi.inflight").add(-1);
    metrics.histogram("pi.latency", { unit: "ms" }).record(120);
    const collected = await h.collect();
    const byName = new Map(collected.map((metric) => [metric.descriptor.name, metric]));
    expect(byName.get("pi.requests")?.descriptor).toMatchObject({ unit: "1", description: "requests" });
    expect(byName.get("pi.requests")?.dataPoints[0]).toMatchObject({ value: 5, attributes: { provider: "x" } });
    expect(byName.get("pi.inflight")?.dataPoints[0]?.value).toBe(0);
    expect(byName.get("pi.latency")?.dataPoints[0]?.value).toMatchObject({ count: 1, sum: 120 });
    await h.shutdown();
  });

  it("caches instruments by name", () => {
    const h = createMetricsHarness();
    expect(h.telemetry.metrics.counter("same")).toBe(h.telemetry.metrics.counter("same"));
  });

  it("never throws", () => {
    const h = createMetricsHarness();
    expect(() => h.telemetry.metrics.histogram("h").record(Number.NaN, { a: [] })).not.toThrow();
  });
});
