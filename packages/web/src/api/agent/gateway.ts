// ─── Gateway IA intelligent : clé perso (provider direct) ou Runable Gateway ──
//
// Comportement :
//   - Par défaut, tous les appels passent par le Runable AI Gateway.
//   - Dès qu'une clé perso VALIDE est configurée pour un provider (openai,
//     anthropic, google, ou "custom" OpenAI-compatible), les modèles de ce
//     provider (`openai/...`, `anthropic/...`, `google/...`) sont routés EN
//     DIRECT vers l'API du provider avec la clé perso — plus via le gateway.
//   - Repli automatique sur le gateway si pas de clé perso pour ce provider.
//
// Les clés sont injectées par secret-store.ts via setProviderKeys() (déchiffrées,
// jamais exposées au front). Le résolveur reste SYNCHRONE (cache mémoire) pour ne
// pas casser les ~centaines d'appels existants `gateway(model)`.
//
import { createGateway } from "@ai-sdk/gateway";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

export interface CustomProvider {
  apiKey: string;
  baseUrl?: string;
}

// Cache mémoire des clés perso (peuplé par secret-store.loadAllSecrets / écritures).
// Persisté sur globalThis pour survivre au HMR / re-eval SSR.
let providerKeys: Record<string, CustomProvider> =
  ((globalThis as any).__velbaz_provider_keys ??= {});

/** Remplace la table des clés perso et la fige sur globalThis. */
export function setProviderKeys(keys: Record<string, CustomProvider>) {
  providerKeys = keys;
  (globalThis as any).__velbaz_provider_keys = keys;
}

export function hasCustomProvider(provider: string): boolean {
  return !!providerKeys[provider]?.apiKey;
}

// ── Modèle UNCENSORED par défaut (mode admin safety-off) ────────────────────
// Modifiable via env UNCENSORED_MODEL. Doit être un id OpenRouter préfixé
// "openrouter/". Défaut : Venice Uncensored (gratuit sur OpenRouter).
export const UNCENSORED_MODEL: string =
  process.env.UNCENSORED_MODEL || "openrouter/cognitivecomputations/dolphin-mistral-24b-venice-edition:free";

/** Vrai si une clé OpenRouter est configurée -> les modèles uncensored marchent. */
export function hasUncensoredProvider(): boolean {
  return !!(providerKeys["openrouter"]?.apiKey || process.env.OPENROUTER_API_KEY);
}

// Runable AI Gateway (défaut / repli).
const runableGateway = createGateway({
  baseURL: process.env.AI_GATEWAY_BASE_URL,
  apiKey: process.env.AI_GATEWAY_API_KEY,
});

/**
 * Résout un identifiant de modèle ("anthropic/claude-...", "openai/gpt-...",
 * "google/gemini-...") vers un LanguageModel.
 *   - clé perso présente pour le provider -> appel direct provider.
 *   - sinon -> Runable Gateway (comportement historique inchangé).
 */
export function gateway(modelId: string): LanguageModel {
  // ── Routage UNCENSORED via OpenRouter (mode admin safety-off) ──────────────
  // Un id de modèle préfixé "openrouter/" est envoyé EN DIRECT à OpenRouter
  // (OpenAI-compatible), en conservant l'id COMPLET du modèle (ex.
  // "openrouter/venice/uncensored:free" -> modèle "venice/uncensored:free").
  // Nécessite OPENROUTER_API_KEY (ou une clé "openrouter" dans le secret-store).
  if (modelId.startsWith("openrouter/")) {
    const orKey = providerKeys["openrouter"]?.apiKey || process.env.OPENROUTER_API_KEY;
    const orModel = modelId.slice("openrouter/".length);
    if (orKey) {
      const orBase = providerKeys["openrouter"]?.baseUrl || "https://openrouter.ai/api/v1";
      try {
        return createOpenAI({ apiKey: orKey, baseURL: orBase })(orModel);
      } catch (e) {
        console.warn(`[gateway] OpenRouter KO, repli gateway :`, (e as Error).message);
      }
    } else {
      console.warn("[gateway] modèle openrouter demandé mais AUCUNE clé OPENROUTER_API_KEY — repli gateway (censuré)");
    }
    // Pas de clé/échec -> on retombe sur le modèle par défaut du gateway (censuré).
    return runableGateway(orModel);
  }

  const slash = modelId.indexOf("/");
  const provider = slash > 0 ? modelId.slice(0, slash) : "";
  const name = slash > 0 ? modelId.slice(slash + 1) : modelId;
  const custom = provider ? providerKeys[provider] : undefined;

  if (custom?.apiKey) {
    try {
      switch (provider) {
        case "openai":
          return createOpenAI({ apiKey: custom.apiKey, baseURL: custom.baseUrl })(name);
        case "anthropic":
          return createAnthropic({ apiKey: custom.apiKey, baseURL: custom.baseUrl })(name);
        case "google":
          return createGoogleGenerativeAI({ apiKey: custom.apiKey, baseURL: custom.baseUrl })(name);
      }
    } catch (e) {
      console.warn(`[gateway] provider perso ${provider} KO, repli gateway :`, (e as Error).message);
    }
  }

  // Provider "custom" OpenAI-compatible (OpenRouter, Groq, Together, DeepSeek…) :
  // s'applique quel que soit le préfixe si une clé "custom" est configurée.
  const customCompat = providerKeys["custom"];
  if (customCompat?.apiKey && customCompat.baseUrl && !custom?.apiKey) {
    try {
      return createOpenAI({ apiKey: customCompat.apiKey, baseURL: customCompat.baseUrl })(name || modelId);
    } catch (e) {
      console.warn(`[gateway] provider custom KO, repli gateway :`, (e as Error).message);
    }
  }

  return runableGateway(modelId);
}
