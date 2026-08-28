// ─── AI Usage Logger (server-side only, NEVER exposed via API or UI) ─────────
// Appends one JSON line per AI call to data/ai-usage.jsonl with token counts
// and estimated USD cost. No endpoint reads this file — admin/devops only.
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const LOG_DIR = join(process.cwd(), "data");
const LOG_FILE = join(LOG_DIR, "ai-usage.jsonl");

// [input $/M tokens, output $/M tokens]
const PRICES: Record<string, [number, number]> = {
  "anthropic/claude-haiku-4.5": [1, 5],
  "anthropic/claude-sonnet-4.5": [3, 15],
  "anthropic/claude-sonnet-4.6": [3, 15],
  "anthropic/claude-opus-4.7": [15, 75],
  "openai/gpt-5.4": [1.25, 10],
  "openai/gpt-5.4-mini": [0.25, 2],
  "openai/gpt-5.4-nano": [0.05, 0.4],
  "google/gemini-3-flash": [0.5, 3],
  "google/gemini-2.0-flash-001": [0.1, 0.4],
};

export function logAiUsage(model: string, usage: any, tag: string, flatCost?: number): void {
  // Fire-and-forget: logging must never slow down or break an AI call.
  (async () => {
    try {
      const input = Number(usage?.inputTokens ?? usage?.promptTokens ?? 0) || 0;
      const output = Number(usage?.outputTokens ?? usage?.completionTokens ?? 0) || 0;
      const [pi, po] = PRICES[model] || [1, 5];
      const cost = flatCost != null ? flatCost : (input * pi + output * po) / 1_000_000;
      await mkdir(LOG_DIR, { recursive: true });
      const line = JSON.stringify({
        t: new Date().toISOString(),
        tag,
        model,
        input,
        output,
        cost: Number(cost.toFixed(6)),
      });
      await appendFile(LOG_FILE, line + "\n");
    } catch {
      /* silent */
    }
  })();
}
