import { describe, it } from "vitest";
import {
  createTelemetryAdapterConformance,
  type TelemetryAdapterFixture,
} from "@earendil-works/pi-telemetry/testing";
import { createHarness, normalizeSpans } from "./helpers.js";

const conformance = createTelemetryAdapterConformance(async () => {
  const harness = createHarness();
  return {
    context: harness.telemetry,
    getSpans: async () => normalizeSpans(harness.spans()),
    async [Symbol.asyncDispose]() {
      await harness.shutdown();
    },
  } satisfies TelemetryAdapterFixture;
});

describe("official telemetry adapter conformance", () => {
  for (const group of new Set(conformance.map((testCase) => testCase.group))) {
    describe(group, () => {
      for (const testCase of conformance.filter((candidate) => candidate.group === group)) {
        it(testCase.name, () => testCase.run());
      }
    });
  }
});
