import { SpanKind, type Attributes } from "@opentelemetry/api";

/** One source attribute copied (optionally transformed) to a GenAI semantic-convention attribute. */
export interface GenAiMapping {
  /** Source key, or several keys combined by `combine`. */
  from: string | readonly string[];
  to: string;
  /** Single-key mappings: transforms the source value. */
  transform?: (value: Attributes[string]) => Attributes[string];
  /** Multi-key mappings: receives the values present in the same batch (never empty). */
  combine?: (values: Attributes[string][]) => Attributes[string];
}

export interface GenAiSpanRule {
  /** Span kind passed to the tracer when the span starts. */
  kind?: SpanKind;
  /** Attributes added when the span starts. */
  constants?: Attributes;
  /** Applied to every attribute batch (start and `setAttributes`) containing the `from` key. */
  mappings: readonly GenAiMapping[];
}

/** pi-ai StopReason -> GenAI well-known finish reason; unknown values pass through. */
const FINISH_REASONS: Readonly<Record<string, string>> = {
  stop: "stop",
  length: "length",
  toolUse: "tool_call",
  error: "error",
};

const finishReason = <T>(value: T): T | string =>
  typeof value === "string" && Object.hasOwn(FINISH_REASONS, value) ? FINISH_REASONS[value]! : value;

const asFinishReasons = (value: Attributes[string]): Attributes[string] => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return (value as unknown[]).map(finishReason) as Attributes[string];
  return [String(finishReason(value))];
};

/** GenAI input tokens include cached tokens, while pi-ai's `usage.input` excludes them. */
const sumNumbers = (values: Attributes[string][]): Attributes[string] => {
  const numbers = values.filter((value): value is number => typeof value === "number");
  return numbers.length === 0 ? undefined : numbers.reduce((total, value) => total + value, 0);
};

/** GenAI mapping rules keyed by pi span name. Extend here to cover more spans. */
export const GENAI_RULES: Readonly<Record<string, GenAiSpanRule>> = {
  "pi.ai.request": {
    kind: SpanKind.CLIENT,
    constants: { "gen_ai.operation.name": "chat" },
    mappings: [
      { from: "provider", to: "gen_ai.provider.name" },
      { from: "model", to: "gen_ai.request.model" },
      {
        from: ["usage.input", "usage.cache_read", "usage.cache_write"],
        to: "gen_ai.usage.input_tokens",
        combine: sumNumbers,
      },
      { from: "usage.output", to: "gen_ai.usage.output_tokens" },
      { from: "usage.cache_read", to: "gen_ai.usage.cache_read.input_tokens" },
      { from: "usage.cache_write", to: "gen_ai.usage.cache_creation.input_tokens" },
      { from: "stop", to: "gen_ai.response.finish_reasons", transform: asFinishReasons },
      { from: "response.id", to: "gen_ai.response.id" },
    ],
  },
};

/** Returns the span kind declared by the rule for `spanName`, if any. */
export function genAiSpanKind(
  spanName: string,
  rules: Readonly<Record<string, GenAiSpanRule>> = GENAI_RULES,
): SpanKind | undefined {
  return rules[spanName]?.kind;
}

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
  for (const { from, to, transform, combine } of rule.mappings) {
    let value: Attributes[string];
    if (typeof from === "string") {
      const raw = attributes[from];
      if (raw === undefined) continue;
      value = transform ? transform(raw) : raw;
    } else {
      const present = from.map((key) => attributes[key]).filter((raw) => raw !== undefined);
      if (present.length === 0) continue;
      value = combine ? combine(present) : undefined;
    }
    if (value !== undefined) result[to] = value;
  }
  return result;
}
