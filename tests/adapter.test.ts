import { SpanStatusCode } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { createOtelTelemetry } from "../src/index.js";
import { createHarness } from "./helpers.js";

describe("nesting", () => {
  it("nests grandchildren and shares the traceId", async () => {
    const h = createHarness();
    await h.telemetry.startSpan({ name: "a" }, (a) =>
      a.startSpan({ name: "b" }, (b) => b.startSpan({ name: "c" }, () => undefined)),
    );
    const [a, b, c] = ["a", "b", "c"].map((name) => h.byName(name));
    expect(a?.parentSpanContext).toBeUndefined();
    expect(b?.parentSpanContext?.spanId).toBe(a?.spanContext().spanId);
    expect(c?.parentSpanContext?.spanId).toBe(b?.spanContext().spanId);
    expect(new Set([a, b, c].map((s) => s?.spanContext().traceId)).size).toBe(1);
  });

  it("starts independent traces from the root context", async () => {
    const h = createHarness();
    await h.telemetry.startSpan({ name: "one" }, () => undefined);
    await h.telemetry.startSpan({ name: "two" }, () => undefined);
    expect(h.byName("one").spanContext().traceId).not.toBe(h.byName("two").spanContext().traceId);
  });

  it("does not use ambient context", async () => {
    const h = createHarness();
    await h.telemetry.startSpan({ name: "outer" }, async () => {
      await h.telemetry.startSpan({ name: "sibling" }, () => undefined);
    });
    expect(h.byName("sibling").parentSpanContext).toBeUndefined();
  });
});

describe("links", () => {
  it("links to a span produced by the adapter and skips foreign contexts", async () => {
    const h = createHarness();
    let target: Parameters<Parameters<typeof h.telemetry.startSpan>[1]>[0] | undefined;
    await h.telemetry.startSpan({ name: "target" }, (span) => {
      target = span;
    });
    const foreign = { startSpan: () => Promise.resolve(undefined) } as never;
    await h.telemetry.startSpan(
      { name: "source", links: [{ context: target!, attributes: { kind: "follows" } }, { context: foreign }] },
      (span) => {
        span.addLink({ context: target! });
        span.addLink({ context: foreign });
      },
    );
    const links = h.byName("source").links;
    expect(links).toHaveLength(2);
    expect(links[0]?.context.spanId).toBe(h.byName("target").spanContext().spanId);
    expect(links[0]?.attributes).toEqual({ kind: "follows" });
  });
});

describe("recording", () => {
  it("records events with attributes in order", async () => {
    const h = createHarness();
    await h.telemetry.startSpan({ name: "s" }, (span) => {
      span.addEvent("first", { n: 1, skipped: undefined });
      span.addEvent("second");
    });
    const events = h.byName("s").events;
    expect(events.map((e) => e.name)).toEqual(["first", "second"]);
    expect(events[0]?.attributes).toEqual({ n: 1 });
  });

  it("merges attributes, ignores undefined and passes arrays through", async () => {
    const h = createHarness();
    await h.telemetry.startSpan({ name: "s", attributes: { a: 1, b: undefined, list: ["x", "y"] } }, (span) => {
      span.setAttributes({ a: 2, c: true, nums: [1, 2] });
      span.setAttributes({ a: undefined });
    });
    expect(h.byName("s").attributes).toEqual({ a: 2, list: ["x", "y"], c: true, nums: [1, 2] });
  });

  it("ignores calls after settlement and records no late children", async () => {
    const h = createHarness();
    let late: { setAttributes(a: object): void; addEvent(n: string): void } | undefined;
    await h.telemetry.startSpan({ name: "s" }, (span) => {
      late = span;
    });
    late?.setAttributes({ x: 1 });
    late?.addEvent("late");
    expect(h.byName("s").attributes).toEqual({});
    expect(h.byName("s").events).toHaveLength(0);
  });
});

describe("status", () => {
  it("leaves UNSET on success", async () => {
    const h = createHarness();
    await h.telemetry.startSpan({ name: "s" }, () => 1);
    expect(h.byName("s").status.code).toBe(SpanStatusCode.UNSET);
  });

  it("maps explicit ok to OK, last write wins", async () => {
    const h = createHarness();
    await h.telemetry.startSpan({ name: "s" }, (span) => {
      span.setStatus({ status: "error", error: { name: "E", message: "m" } });
      span.setStatus({ status: "ok" });
    });
    expect(h.byName("s").status.code).toBe(SpanStatusCode.OK);
    expect(h.byName("s").attributes["error.type"]).toBeUndefined();
  });

  it("maps explicit error with message and error.type", async () => {
    const h = createHarness();
    await h.telemetry.startSpan({ name: "s" }, (span) => {
      span.setStatus({ status: "error", error: { name: "SaveError", message: "disk full" } });
    });
    const span = h.byName("s");
    expect(span.status).toEqual({ code: SpanStatusCode.ERROR, message: "disk full" });
    expect(span.attributes["error.type"]).toBe("SaveError");
  });

  it("maps a thrown error to ERROR and records the exception", async () => {
    const h = createHarness();
    const failure = new TypeError("boom");
    await expect(
      h.telemetry.startSpan({ name: "s" }, () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    const span = h.byName("s");
    expect(span.status).toEqual({ code: SpanStatusCode.ERROR, message: "boom" });
    expect(span.attributes["error.type"]).toBe("TypeError");
    const exception = span.events.find((e) => e.name === "exception");
    expect(exception?.attributes?.["exception.type"]).toBe("TypeError");
    expect(exception?.attributes?.["exception.message"]).toBe("boom");
  });

  it("handles non-Error rejections", async () => {
    const h = createHarness();
    await expect(h.telemetry.startSpan({ name: "s" }, () => Promise.reject("plain"))).rejects.toBe("plain");
    expect(h.byName("s").status).toEqual({ code: SpanStatusCode.ERROR, message: "plain" });
  });

  it("keeps an explicit status over automatic error mapping", async () => {
    const h = createHarness();
    await expect(
      h.telemetry.startSpan({ name: "s" }, (span) => {
        span.setStatus({ status: "ok" });
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
    expect(h.byName("s").status.code).toBe(SpanStatusCode.OK);
  });
});

describe("lifecycle", () => {
  it("keeps the span open until the promise settles", async () => {
    const h = createHarness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pending = h.telemetry.startSpan({ name: "s" }, () => gate);
    await Promise.resolve();
    expect(h.spans()).toHaveLength(0);
    release();
    await pending;
    expect(h.spans()).toHaveLength(1);
  });
});

describe("robustness", () => {
  const throwing = (): Record<string, unknown> => ({
    ok: 1,
    get bad(): string {
      throw new Error("unreadable");
    },
    also: "fine",
  });

  it("keeps the readable subset of start attributes when one getter throws", async () => {
    const h = createHarness();
    await h.telemetry.startSpan({ name: "s", attributes: throwing() as never }, () => undefined);
    expect(h.byName("s").attributes).toEqual({ ok: 1, also: "fine" });
  });

  it("still creates the span when the attribute bag is a throwing Proxy", async () => {
    const h = createHarness();
    const proxy = new Proxy({}, { ownKeys: () => { throw new Error("no keys"); } });
    await h.telemetry.startSpan({ name: "s", attributes: proxy as never }, () => undefined);
    expect(h.byName("s").attributes).toEqual({});
  });

  it("drops only the bad link and survives a non-iterable links option", async () => {
    const h = createHarness();
    let target: Parameters<Parameters<typeof h.telemetry.startSpan>[1]>[0] | undefined;
    await h.telemetry.startSpan({ name: "target" }, (span) => {
      target = span;
    });
    const broken = {
      get context(): never {
        throw new Error("unreadable");
      },
    };
    await h.telemetry.startSpan(
      { name: "mixed", links: [broken, { context: target!, attributes: throwing() as never }] as never },
      () => undefined,
    );
    const links = h.byName("mixed").links;
    expect(links).toHaveLength(1);
    expect(links[0]?.attributes).toEqual({ ok: 1, also: "fine" });

    await h.telemetry.startSpan({ name: "plain", links: 42 as never }, () => undefined);
    expect(h.byName("plain").links).toHaveLength(0);
  });

  it("setAttributes stays atomic: an unreadable value drops the whole batch", async () => {
    const h = createHarness();
    await h.telemetry.startSpan({ name: "s", attributes: { kept: 1 } }, (span) => {
      expect(() => span.setAttributes(throwing() as never)).not.toThrow();
      span.setAttributes({ later: 2 });
    });
    expect(h.byName("s").attributes).toEqual({ kept: 1, later: 2 });
  });

  it("addLink is a no-op when the span has no addLink", async () => {
    const calls: string[] = [];
    const fakeSpan = {
      setAttributes: () => fakeSpan,
      addEvent: () => fakeSpan,
      setStatus: () => fakeSpan,
      end: () => calls.push("end"),
      spanContext: () => ({ traceId: "0".repeat(32), spanId: "0".repeat(16), traceFlags: 0 }),
    };
    const telemetry = createOtelTelemetry({ tracer: { startSpan: () => fakeSpan } as never });
    await telemetry.startSpan({ name: "s" }, (span) => {
      expect(() => span.addLink({ context: telemetry })).not.toThrow();
    });
    expect(calls).toEqual(["end"]);
  });
});
