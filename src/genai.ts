import type { Attributes } from "@opentelemetry/api";

/** One source attribute copied (optionally transformed) to a GenAI semantic-convention attribute. */
export interface GenAiMapping {
  from: string;
  to: string;
  transform?: (value: Attributes[string]) => Attributes[string];
}

export interface GenAiSpanRule {
  /** Attributes added when the span starts. */
  constants?: Attributes;
  /** Applied to every attribute batch (start and `setAttributes`) containing the `from` key. */
  mappings: readonly GenAiMapping[];
}

const asList = (value: Attributes[string]): Attributes[string] =>
  value === undefined ? undefined : [String(value)];

/** GenAI mapping rules keyed by pi span name. Extend here to cover more spans. */
export const GENAI_RULES: Readonly<Record<string, GenAiSpanRule>> = {
  "pi.ai.request": {
    constants: { "gen_ai.operation.name": "chat" },
    mappings: [
      { from: "provider", to: "gen_ai.provider.name" },
      { from: "model", to: "gen_ai.request.model" },
      { from: "usage.input", to: "gen_ai.usage.input_tokens" },
      { from: "usage.output", to: "gen_ai.usage.output_tokens" },
      { from: "usage.cache_read", to: "gen_ai.usage.cache_read.input_tokens" },
      { from: "stop", to: "gen_ai.response.finish_reasons", transform: asList },
      { from: "response.id", to: "gen_ai.response.id" },
    ],
  },
};

/** Returns the GenAI attributes derived from `attributes` for a span named `spanName`. */
export function genAiAttributes(
  spanName: string,
  attributes: Attributes,
  isStart: boolean,
  rules: Readonly<Record<string, GenAiSpanRule>> = GENAI_RULES,
): Attributes {
  const rule = rules[spanName];
  if (!rule) return {};
  const result: Attributes = isStart ? { ...rule.constants } : {};
  for (const { from, to, transform } of rule.mappings) {
    const raw = attributes[from];
    if (raw === undefined) continue;
    const value = transform ? transform(raw) : raw;
    if (value !== undefined) result[to] = value;
  }
  return result;
}
