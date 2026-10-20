import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { SpanKind } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { genAiAttributes } from "../src/genai.js";
import { createHarness } from "./helpers.js";

describe("genAi option", () => {
  it("adds GenAI attributes next to the original ones on pi.ai.request", async () => {
    const h = createHarness({ genAi: true });
    await h.telemetry.startSpan(
      { name: "pi.ai.request", attributes: { provider: "openai", model: "gpt-x", api: "responses", reasoning: false } },
      (span) => {
        span.setAttributes({
          stop: "stop",
          "usage.input": 10,
          "usage.output": 5,
          "usage.cache_read": 4,
          "usage.cache_write": 1,
          "cost.total": 0.01,
          "response.id": "resp_1",
        });
      },
    );
    const attributes = h.byName("pi.ai.request").attributes;
    expect(attributes).toMatchObject({
      provider: "openai",
      model: "gpt-x",
      "usage.input": 10,
      "response.id": "resp_1",
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": "openai",
      "gen_ai.request.model": "gpt-x",
      "gen_ai.usage.input_tokens": 15,
      "gen_ai.usage.output_tokens": 5,
      "gen_ai.usage.cache_read.input_tokens": 4,
      "gen_ai.usage.cache_creation.input_tokens": 1,
      "gen_ai.response.finish_reasons": ["stop"],
      "gen_ai.response.id": "resp_1",
    });
  });

  it("starts pi.ai.request as a CLIENT span only when genAi is on", async () => {
    const on = createHarness({ genAi: true });
    await on.telemetry.startSpan({ name: "pi.ai.request" }, () => undefined);
    await on.telemetry.startSpan({ name: "other" }, () => undefined);
    expect(on.byName("pi.ai.request").kind).toBe(SpanKind.CLIENT);
    expect(on.byName("other").kind).toBe(SpanKind.INTERNAL);

    const off = createHarness();
    await off.telemetry.startSpan({ name: "pi.ai.request" }, () => undefined);
    expect(off.byName("pi.ai.request").kind).toBe(SpanKind.INTERNAL);
  });

  it("is off by default and ignores other span names", async () => {
    const off = createHarness();
    await off.telemetry.startSpan({ name: "pi.ai.request", attributes: { provider: "p" } }, () => undefined);
    expect(Object.keys(off.byName("pi.ai.request").attributes).some((k) => k.startsWith("gen_ai."))).toBe(false);

    const on = createHarness({ genAi: true });
    await on.telemetry.startSpan({ name: "other", attributes: { provider: "p" } }, () => undefined);
    expect(on.byName("other").attributes).toEqual({ provider: "p" });
  });

  it("maps a request executed against the offline faux provider", async () => {
    const h = createHarness({ genAi: true });
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage("hello", { responseId: "faux-1" })]);
    const model = faux.getModel();

    const message = await h.telemetry.startSpan(
      { name: "pi.ai.request", attributes: { provider: model.provider, model: model.id, api: model.api } },
      async (span) => {
        const result = await models.completeSimple(
          model,
          { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
          { telemetryContext: span },
        );
        span.setAttributes({
          stop: result.stopReason,
          "usage.input": result.usage.input,
          "usage.output": result.usage.output,
          "usage.cache_read": result.usage.cacheRead,
          "response.id": result.responseId,
        });
        return result;
      },
    );

    const attributes = h.byName("pi.ai.request").attributes;
    expect(attributes["gen_ai.provider.name"]).toBe(model.provider);
    expect(attributes["gen_ai.request.model"]).toBe(model.id);
    expect(attributes["gen_ai.response.finish_reasons"]).toEqual([message.stopReason]);
    expect(attributes["gen_ai.response.id"]).toBe("faux-1");
    expect(attributes["gen_ai.usage.input_tokens"]).toBe(message.usage.input);
  });
});

describe("genAiAttributes rules", () => {
  const finish = (stop: unknown) =>
    genAiAttributes("pi.ai.request", { stop: stop as string }, false)["gen_ai.response.finish_reasons"];

  it("maps pi-ai stop reasons to GenAI finish reasons and passes unknown values through", () => {
    expect(finish("stop")).toEqual(["stop"]);
    expect(finish("length")).toEqual(["length"]);
    expect(finish("toolUse")).toEqual(["tool_call"]);
    expect(finish("error")).toEqual(["error"]);
    expect(finish("aborted")).toEqual(["aborted"]);
    expect(finish("constructor")).toEqual(["constructor"]);
  });

  it("maps each element of an array source instead of joining it", () => {
    expect(finish(["toolUse", "stop", "custom"])).toEqual(["tool_call", "stop", "custom"]);
  });

  it("sums input, cache_read and cache_write present in the same batch", () => {
    const tokens = (batch: Record<string, number | string>) =>
      genAiAttributes("pi.ai.request", batch, false)["gen_ai.usage.input_tokens"];
    expect(tokens({ "usage.input": 10, "usage.cache_read": 4, "usage.cache_write": 1 })).toBe(15);
    expect(tokens({ "usage.input": 10, "usage.cache_read": 4 })).toBe(14);
    expect(tokens({ "usage.cache_write": 2 })).toBe(2);
    expect(tokens({ "usage.input": 10, "usage.cache_read": "n/a" })).toBe(10);
    expect(tokens({ "usage.output": 3 })).toBeUndefined();
    expect(genAiAttributes("pi.ai.request", { "usage.cache_write": 2 }, false)).toMatchObject({
      "gen_ai.usage.cache_creation.input_tokens": 2,
    });
  });
});
