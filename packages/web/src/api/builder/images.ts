// ─── Content image generation for generated sites & apps ─────────────────────
// The build already produces a brand logo. This module produces the CONTENT
// imagery a page actually needs (hero, section illustrations, gallery, about,
// backgrounds…). An LLM "art director" decides how many visuals each page needs
// (NO fixed cap), we generate them via Gemini image, compress to WebP with sharp
// to keep the data URIs light, and expose them as a data-URI manifest that is
// written into the generated app as `src/lib/images.ts` (web) or an equivalent
// mobile constants file. Because that manifest is a plain project file, it is
// already covered by the checkpoint snapshot / rollback / fork machinery.
import { generateText } from "ai";
import sharp from "sharp";
import { gateway } from "../agent/gateway";

export type ImageAspect = "wide" | "square" | "portrait" | "tall";

export interface ImageSlot {
  key: string;        // stable identifier used in code, ex: "home_hero"
  page: string;       // page file this visual belongs to, ex: "Home.tsx"
  prompt: string;     // description of the image to generate
  aspect: ImageAspect;
  role: string;       // hero | feature | gallery | about | background | avatar | banner
  alt: string;        // accessible description (in the app language)
}

export interface ImageManifest {
  // key -> data URI (data:image/webp;base64,…)
  urls: Record<string, string>;
  // key -> metadata so PAGE_PROMPT can tell the model what each visual is for
  meta: Record<string, { alt: string; role: string; page: string }>;
}

const ASPECT_HINT: Record<ImageAspect, string> = {
  wide: "wide 16:9 landscape composition",
  square: "square 1:1 composition",
  portrait: "portrait 4:5 composition",
  tall: "tall 9:16 vertical composition",
};

// Target width (px) per role — keeps the base64 payload reasonable even with
// many images. Heroes/banners stay crisp; avatars/thumbs are small.
function widthForRole(role: string): number {
  const r = role.toLowerCase();
  if (r.includes("avatar") || r.includes("thumb") || r.includes("icon")) return 400;
  if (r.includes("feature") || r.includes("gallery") || r.includes("about") || r.includes("card")) return 1000;
  return 1600; // hero, banner, background, default
}

function extractJSON(raw: string): any {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

// Generate ONE image and return a compressed WebP data URI (or null on failure —
// never throws, so a failed visual just drops out of the manifest).
export async function generateContentImage(
  prompt: string,
  aspect: ImageAspect = "wide",
  maxWidth = 1600,
  opts: {
    /** Images de référence (data URI ou base64) données au modèle comme ancre visuelle. */
    refImages?: string[];
    /** Laisse passer le texte : indispensable pour une maquette d'écran. */
    allowText?: boolean;
  } = {},
): Promise<string | null> {
  try {
    const fullPrompt =
      `${prompt}. ${ASPECT_HINT[aspect]}. High-quality, photorealistic where appropriate or clean modern illustration, ` +
      `professional, cohesive lighting and color grading.` +
      (opts.allowText ? "" : " NO text, NO watermark, NO logo, NO UI chrome, no borders.");
    const refs = (opts.refImages ?? []).filter(Boolean);
    const result = await generateText({
      model: gateway("google/gemini-3-pro-image"),
      ...(refs.length
        ? {
            messages: [{
              role: "user" as const,
              content: [
                { type: "text" as const, text: `Generate an image: ${fullPrompt}` },
                ...refs.map(image => ({ type: "image" as const, image })),
              ],
            }],
          }
        : { prompt: `Generate an image: ${fullPrompt}` }),
      providerOptions: { gateway: { response_modalities: ["IMAGE"] } },
    } as any);
    const file = result.files?.[0];
    if (!file?.base64) {
      console.error("[generateContentImage] no image in response");
      return null;
    }
    const input = Buffer.from(file.base64, "base64");
    const webp = await sharp(input)
      .resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return `data:image/webp;base64,${webp.toString("base64")}`;
  } catch (e) {
    console.error("[generateContentImage] failed:", e);
    return null;
  }
}

// ── Art director: decide which visuals each page needs (NO fixed cap) ──
export interface PlanImagesInput {
  companyName: string;
  idea: string;
  industry?: string;
  lang: string;
  design: any;
  pages: Array<{ name: string; file: string; purpose?: string; sections?: string; route?: string }>;
}

const ART_DIRECTOR_SYSTEM =
  "Tu es directeur artistique. Tu décides des VISUELS (photos/illustrations) dont chaque page d'un site ou d'une app a besoin " +
  "pour être belle et crédible. Tu réponds UNIQUEMENT en JSON valide.";

export async function planImageSlots(input: PlanImagesInput): Promise<ImageSlot[]> {
  const palette = input.design?.colors
    ? Object.entries(input.design.colors).map(([k, v]) => `${k}:${v}`).join(", ")
    : "";
  const pagesBlock = input.pages
    .map((p) => `- ${p.file} — "${p.name}" (${p.route || ""}) · but: ${p.purpose || ""} · sections: ${p.sections || ""}`)
    .join("\n");
  const prompt =
`Entreprise: "${input.companyName}"
Idée: ${input.idea}
Secteur: ${input.industry || "non précisé"}
Palette du design: ${palette}
Langue de l'app (pour les textes ALT): ${input.lang}

Pages du projet:
${pagesBlock}

Décide des VISUELS générés à afficher sur ces pages. Règles:
- Propose autant de visuels que le design en a réellement besoin — AUCUNE limite fixe. Les pages "à propos", galerie, produits, services méritent plusieurs photos de CONTENU. Une page purement CRUD/dashboard n'en a souvent pas besoin.
- INTERDICTION ABSOLUE de fonds en image : ne propose JAMAIS de fond plein écran, de texture, de motif répété, d'image d'ambiance derrière du texte, de fond de héro, de fond de bannière ou de fond de section. Ces fonds seront faits en CSS (dégradés / couleurs de la palette), PAS en image. Les rôles "background", "texture", "overlay" sont INTERDITS.
- Un visuel est donc TOUJOURS une image de CONTENU encadrée : une photo de section, une vignette de galerie, un portrait d'équipe, une photo produit, une illustration dans une carte. Jamais une image posée derrière du texte.
- Un héro peut avoir une photo, mais uniquement comme élément encadré À CÔTÉ du texte (moitié d'écran, carte, mockup), jamais en fond derrière le texte.
- N'invente pas de visuels gratuits: chaque visuel doit correspondre à une section réelle de la page.
- Chaque "prompt" décrit une image concrète, cohérente avec la marque et le secteur, dans l'esprit de la palette. PAS de texte incrusté, pas de logo, pas de capture d'UI.
- "key" = identifiant court, stable, en snake_case, unique (ex: "home_hero", "about_team", "services_grid_1", "product_1").
- "aspect": "wide" (large/paysage), "square" (carte/galerie), "portrait" (photo verticale), "tall" (verticale mobile).
- "role": hero | feature | gallery | about | banner | avatar | card. (Les rôles de fond sont interdits.)
- "alt": description accessible courte dans la langue de l'app.

Réponds en JSON strict:
{"slots":[{"key":"home_hero","page":"Home.tsx","prompt":"...","aspect":"wide","role":"hero","alt":"..."}]}`;

  try {
    const { text } = await generateText({
      model: gateway("google/gemini-3-flash"),
      system: ART_DIRECTOR_SYSTEM,
      prompt,
      maxOutputTokens: 4000,
    });
    const obj = extractJSON(text);
    const raw: any[] = Array.isArray(obj?.slots) ? obj.slots : [];
    const validPages = new Set(input.pages.map((p) => p.file));
    const seen = new Set<string>();
    const slots: ImageSlot[] = [];
    // Les fonds en image sont interdits : ils ne s'adaptent pas au mode sombre
    // et rendent moche. Les fonds doivent être en CSS (dégradés/couleurs).
    const FORBIDDEN_ROLES = new Set(["background", "texture", "overlay", "backdrop", "pattern"]);
    for (const s of raw) {
      const key = String(s?.key || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_|_$/g, "");
      const prompt = String(s?.prompt || "").trim();
      if (!key || !prompt || seen.has(key)) continue;
      const roleLc = String(s?.role || "feature").trim().toLowerCase();
      // Drop tout visuel destiné à être posé en fond derrière du contenu.
      if (FORBIDDEN_ROLES.has(roleLc) || /_bg$|_background$|backdrop|texture|overlay/.test(key)) continue;
      const page = validPages.has(String(s?.page)) ? String(s.page) : input.pages[0]?.file || "Home.tsx";
      const aspect = (["wide", "square", "portrait", "tall"].includes(s?.aspect) ? s.aspect : "wide") as ImageAspect;
      seen.add(key);
      slots.push({
        key, page, prompt, aspect,
        role: String(s?.role || "feature"),
        alt: String(s?.alt || prompt).slice(0, 160),
      });
    }
    return slots;
  } catch (e) {
    console.error("[planImageSlots] failed:", e);
    return [];
  }
}

// ── Generate all planned slots (bounded parallelism) into a manifest ──
export async function generateImageManifest(
  slots: ImageSlot[],
  onProgress?: (msg: string) => void,
  concurrency = 4,
): Promise<ImageManifest> {
  const manifest: ImageManifest = { urls: {}, meta: {} };
  if (!slots.length) return manifest;
  onProgress?.(`🎨 Direction artistique : ${slots.length} visuel(s) à générer…`);

  let done = 0;
  const queue = [...slots];
  async function worker() {
    for (;;) {
      const slot = queue.shift();
      if (!slot) return;
      const url = await generateContentImage(slot.prompt, slot.aspect, widthForRole(slot.role));
      done++;
      if (url) {
        manifest.urls[slot.key] = url;
        manifest.meta[slot.key] = { alt: slot.alt, role: slot.role, page: slot.page };
        onProgress?.(`🖼️ Visuel « ${slot.key} » généré (${done}/${slots.length})`);
      } else {
        onProgress?.(`⚠️ Visuel « ${slot.key} » non généré — ignoré (${done}/${slots.length})`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, slots.length) }, worker));
  const n = Object.keys(manifest.urls).length;
  onProgress?.(n ? `✅ ${n} visuel(s) généré(s)` : "ℹ️ Aucun visuel généré");
  return manifest;
}

// ── Manifest → per-page prompt block (tells the model what visuals exist) ──
export function imagesPromptBlock(manifest: ImageManifest, pageFile: string, platform: "web" | "mobile" = "web"): string {
  const entries = Object.entries(manifest.meta).filter(([, m]) => m.page === pageFile);
  if (!entries.length) return "";
  const list = entries.map(([key, m]) => `- IMAGES.${key} — ${m.role} · ${m.alt}`).join("\n");
  const usage = platform === "mobile"
    ? `Importe \`{ IMAGES }\` depuis "../lib/images". Ce sont des images de CONTENU encadrées : \`<Image source={{ uri: IMAGES.clé }} style={…} resizeMode="cover" />\`. PAR DÉFAUT ne les pose pas en fond derrière du texte (pas de \`ImageBackground\` plein écran) — sauf si le business/style s'y prête vraiment (hôtel, voyage, restaurant, immobilier, mode…) ou si l'utilisateur le demande explicitement, alors \`ImageBackground\` est autorisé avec un overlay dégradé semi-transparent par-dessus pour garder le texte lisible.`
    : `Importe \`{ IMAGES }\` depuis "../lib/images". Ce sont des images de CONTENU encadrées : \`<img src={IMAGES.clé} alt="…" className="…object-cover rounded-…" />\`. PAR DÉFAUT ne les pose pas en fond de section derrière du texte (\`backgroundImage: url(...)\`) — sauf si le business/style s'y prête vraiment (hôtel, voyage, restaurant, immobilier, mode…) ou si l'utilisateur le demande explicitement, alors c'est autorisé avec un overlay dégradé semi-transparent (\`bg-gradient-to-t from-black/70 …\`) par-dessus pour garder le texte lisible en clair et en sombre.`;
  return `
## VISUELS DISPONIBLES POUR CETTE ${platform === "mobile" ? "ÉCRAN" : "PAGE"} (générés par l'IA)
Ces visuels ont été générés spécifiquement. ${usage}
Utilise-les PAR DÉFAUT comme CONTENU encadré : photo à côté du texte du héro, cartes, galerie, à-propos, produits. Les FONDS de section/héro/bannière restent par défaut des DÉGRADÉS ou COULEURS CSS de la palette, sauf exception ci-dessus. N'utilise QUE ces clés, n'invente aucune URL, ne laisse aucune image cassée.
${list}
`;
}
