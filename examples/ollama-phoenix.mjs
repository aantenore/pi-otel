import { BasicTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { createOtelTelemetry } from "@aantenore/pi-otel";
const AI = process.env.PI_AI_DIST; // path to a pi-ai build with telemetry (main branch until the next release)
const { createModels, createProvider } = await import(AI + "/index.js");
const { openAICompletionsApi } = await import(AI + "/api/openai-completions.lazy.js");

const provider = new BasicTracerProvider({
  resource: resourceFromAttributes({ "service.name": "pi-otel-demo" }),
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: "http://localhost:6006/v1/traces" }))],
});
const telemetry = createOtelTelemetry({ tracer: provider.getTracer("pi-otel-demo"), genAi: true });

const MODEL = process.env.MODEL ?? "gemma4:12b";
const model = { id: MODEL, name: MODEL, api: "openai-completions", provider: "ollama", baseUrl: "http://localhost:11434/v1",
  reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1024 };
const models = createModels();
models.setProvider(createProvider({ id: "ollama", name: "Ollama", baseUrl: model.baseUrl,
  auth: { apiKey: { name: "Ollama", resolve: async () => ({ auth: { apiKey: "ollama" } }) } }, models: [model], api: openAICompletionsApi() }));

const ask = (span, q) => models.complete(models.getModel("ollama", MODEL), { messages: [{ role: "user", content: q, timestamp: Date.now() }] }, { telemetry: span });
const answer = await telemetry.startSpan({ name: "support.ticket", attributes: { "ticket.id": "T-42" } }, async (span) => {
  const summary = await ask(span, "Summarize in one sentence: the checkout page times out for EU users since the last deploy.");
  const reply = await ask(span, "Write a two-sentence apology to the customer about: " + summary.content.map((c) => c.text ?? "").join(""));
  span.setAttributes({ "ticket.resolved": true });
  return reply;
});
console.log(answer.errorMessage, answer.stopReason, JSON.stringify(answer.usage), answer.content.map((c) => c.text ?? "").join("").slice(0, 200));
await provider.forceFlush(); await provider.shutdown();
