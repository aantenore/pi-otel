import { DiagLogLevel, diag } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness } from "./helpers.js";

describe("propagation", () => {
  it("round-trips a W3C traceparent", async () => {
    const producer = createHarness();
    const carrier = await producer.telemetry.startSpan({ name: "client" }, (span) =>
      producer.telemetry.propagation.inject(span),
    );
    const client = producer.byName("client").spanContext();
    expect(carrier.traceparent).toBe(`00-${client.traceId}-${client.spanId}-01`);

    const consumer = createHarness();
    const remote = consumer.telemetry.propagation.extract(carrier);
    await remote.startSpan({ name: "server" }, (span) => span.startSpan({ name: "inner" }, () => undefined));
    const server = consumer.byName("server");
    expect(server.spanContext().traceId).toBe(client.traceId);
    expect(server.parentSpanContext?.spanId).toBe(client.spanId);
    expect(consumer.byName("inner").spanContext().traceId).toBe(client.traceId);
  });

  it("injects nothing for the root context and extracts an empty carrier as a new trace", async () => {
    const h = createHarness();
    expect(h.telemetry.propagation.inject(h.telemetry)).toEqual({});
    await h.telemetry.propagation.extract({}).startSpan({ name: "s" }, () => undefined);
    expect(h.byName("s").parentSpanContext).toBeUndefined();
  });

  it("links to an extracted remote context", async () => {
    const producer = createHarness();
    const carrier = await producer.telemetry.startSpan({ name: "client" }, (span) =>
      producer.telemetry.propagation.inject(span),
    );
    const h = createHarness();
    const remote = h.telemetry.propagation.extract(carrier);
    await h.telemetry.startSpan({ name: "s", links: [{ context: remote }] }, () => undefined);
    expect(h.byName("s").links[0]?.context.spanId).toBe(producer.byName("client").spanContext().spanId);
  });
});

describe("metrics and propagation on every context", () => {
  it("are exposed by child spans and extracted parents", async () => {
    const { createOtelTelemetry } = await import("../src/index.js");
    const telemetry = createOtelTelemetry();
    await telemetry.startSpan({ name: "outer" }, async (span) => {
      expect(span.metrics).toBe(telemetry.metrics);
      expect(span.propagation).toBe(telemetry.propagation);
      await span.startSpan({ name: "inner" }, (inner) => {
        expect(inner.metrics).toBe(telemetry.metrics);
      });
    });
    const remote = telemetry.propagation.extract({});
    expect(remote.propagation).toBe(telemetry.propagation);
  });
});

describe("missing global propagator", () => {
  afterEach(() => diag.disable());

  it("warns once through diag and keeps returning an empty carrier / root", async () => {
    vi.resetModules();
    const warn = vi.fn();
    diag.setLogger({ error() {}, warn, info() {}, debug() {}, verbose() {} }, DiagLogLevel.WARN);
    const { createOtelTelemetry } = await import("../src/index.js");
    const telemetry = createOtelTelemetry();
    expect(telemetry.propagation.inject(telemetry)).toEqual({});
    telemetry.propagation.extract({ traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("W3CTraceContextPropagator");
  });

  it("does not warn when a propagator option is given", async () => {
    vi.resetModules();
    const warn = vi.fn();
    diag.setLogger({ error() {}, warn, info() {}, debug() {}, verbose() {} }, DiagLogLevel.WARN);
    const h = createHarness();
    h.telemetry.propagation.inject(h.telemetry);
    expect(warn).not.toHaveBeenCalled();
  });
});
