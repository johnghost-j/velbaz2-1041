# Règle 5 — preuve par capture réelle (en cours)

## Fait
- Bug racine trouvé et corrigé : brief genesis contenant une URL Google Fonts → détecteur
  de clonage la scrapait → build en "clone fidèle" qui recopiait le CSS comme contenu de
  page. Fix dans `packages/web/src/api/web-tools.ts` : `isAssetUrl()` + `cloneTargets()`
  (fonts.googleapis/gstatic, cdn, .css/.js/.woff/.png…) → jamais cible de clonage.
  `bun run build` vert. Dev server relancé (port 4200).
- Driver Playwright `/tmp/e2e.py` : inscription → attente auth sur /chat → `/genesis <brief>`
  (Escape puis Enter) → attente → capture pleine page + scroll + nav/sections.

## Run 1 (avant fix) — 82b41549 : site cassé (un <pre> de CSS). Preuve du bug.
## Run 2 (après fix) — en cours, marque « couteaux » (t+28min)
- genesis phases 1-8 OK côté serveur, MAIS l'UI du chat s'est vidée vers t+10min
  ("Start a conversation") → le build ne semble pas avoir démarré. À diagnostiquer.

## Reste à faire
1. Comprendre pourquoi la conversation disparaît en cours de genesis dans ce contexte
   Playwright (recharge ? navigation ? ClientRedirect ?).
2. Obtenir un vrai site construit → capture pleine page.
3. Auto-critique vision séparée (« template déjà vu ? »).
4. 2e marque, autre famille chromatique (règle 3).
5. Non-régressions /tmp/verify_tasks.py, /tmp/gen_design.py, /tmp/nobeta.py + bun run build.
6. deliver + résumé court FR, honnête.

## Tour règle 5 (suite)
- R3 corrigé : mémoire anti-répétition déplacée dans packages/web/data/genesis-history.json + patterns ajoutés à server.watch.ignored (vite.config.ts). build vert.
- Run E2E site (couteaux2) : genesis OK, build lancé mais 1 seule page / 1 section → qualité de build encore faible.
- Demande utilisateur : livrer les IMAGES de réflexion (maquettes), pas le site.
- Run mockupOnly (scripts/genesis-mockup-r5.ts) : couteaux 0/10 (3 essais refusés, critère interface 2-4), café 4.7/10. Sorties /home/user/genesis-mockups-r5/.

## 2026-08-28 — R5 (juge design + banque inter-projets)
- Correctif juge : photo = -1 (sans objet) exclu de la moyenne → run r7 (vélos acier, Gand) sort 5.3/10 au lieu de 0/10.
- Banque inter-projets : association enregistrée dans packages/web/data/genesis-history.json (runId + association), ligne ASSOCIATION_RETENUE observée sur r6 et r7.
- Non-régressions OK : TaskGroupRow, GenesisPanel (libellés génériques), pas de BetaGate. bun run build vert (2 tasks, 5.4s).
- Reste : contrôle automatique usesBannedFont() pas branché ; builder ne sort encore qu'1 page / 1 section.

## 2026-08-28 — R6 (3 règles Phase 5 demandées par l'utilisateur)
- Règle 1 : round de 4 variantes TOUJOURS en parallèle, chaque variante ne fait varier qu'un paramètre (angle caméra / intensité lumineuse / position du sujet). GENESIS_MAX_MOCKUP_ROUNDS=2, GENESIS_MAX_MOCKUP_RENDERS=11.
- Règle 2 : judgeMockup renvoie les sous-scores ; progressed() = score global en hausse ET majorité des sous-scores en hausse (photo=-1 exclu). Sinon → nouveau round de variantes. Max 3 retouches par base.
- Règle 3 : P4D_SYSTEM compare maquette retenue vs scene graph, patch JSON fusionné (palette, typography, direction_retenue, consignes_sections_suivantes), sceneGraphRaw réécrit → les sections suivantes suivent la direction retenue. Contrôle usesBannedFont() branché + upsertGenesisMemory(font).
- Test r8 (même brief Ferro & Filo) : 11 rendus, meilleur 7.8/10 (round 2), 642 s. 5 rendus à 0 = juge KO/parse raté, à investiguer.

## 2026-08-28 — R9 (2 bugs signalés par l'utilisateur sur r8)
- Bug 1 (nom de marque qui change en cours de run) : P1_SYSTEM termine par « NOM_DE_MARQUE: ... », extraction + repli FAST_MODEL, constante nameLock injectée dans P4 (scene graph), intent (juge), P5, basePrompt, roundBase (changement de piste), prompt de retouche, P8 spec — et surtout préfixe anglais obligatoire dans le prompt d'image de renderAndJudge (« the only brand name that may appear ... »). Champ GenesisResult.brandName.
- Bug 2 (propagation d'un résultat non validé) : le patch P4D du scene graph n'a lieu QUE si kept.accepted ; sinon degraded=true, weaknesses + sceneGraph.direction_non_validee { score, corrections_en_attente, note } et GenesisResult.pendingFixes rempli. usesBannedFont/upsertGenesisMemory actifs dans les deux branches.
- Test r9 (scripts/genesis-mockup-r9.ts, brief chaussures de sport minimalistes EU) : nom verrouillé « Veld », 5 rendus, 412 s, meilleur 8.3/10 VALIDÉ (premier passage du seuil du juge). Nom identique sur tous les rendus vérifiés à l'œil.
- Branche bug 2 NON exercée par r9 (maquette validée) : code écrit et compilé, pas encore observé en direct.
- Toujours ouvert : 2 rendus sur 5 à 0/10 = juge KO/parse raté ; builder de site sort encore 1 page / 1 section.

## R10 → R12 — annotations de travail + juge illisible

Deux règles ajoutées au moteur `/genesis` (`packages/web/src/api/genesis.ts`) :

1. **Référence de goût réservée à la critique.** `MOCKUP_REF` supprimée, remplacée par
   `JUDGE_CALIBRATION_REF` (`packages/web/public/genesis-refs/intentionality-calibration.png`)
   passée uniquement à `judgeMockup` / `evaluateVisual`, en seconde image, avec
   `CALIBRATION_NOTE` qui interdit d'en tirer palette, sujet, taille ou mise en page.
   Le générateur d'images ne reçoit plus AUCUNE image de référence.
   Critère 5 du juge devenu HIÉRARCHIE / INTENTIONNALITÉ : un vide qui n'est pas
   un parti pris est un défaut, un minimalisme discret n'en est pas un.

2. **Aucune annotation de travail dans le rendu.** Trois couches :
   - `P4B_SYSTEM` interdit de dessiner des mesures ;
   - `scrubMeasurements()` retire du prompt d'image toute mesure chiffrée
     (px, em/rem/pt/vw/vh, %, hex) et la remplace par son équivalent qualitatif —
     le générateur recopiait les chiffres du prompt (r11 : « 96px −0.02em » écrit
     en plein titre) ;
   - `detectWorkAnnotations()` : passe de vision dédiée, DANS le moteur, qui
     relève les marques de travail visibles. Rendu annoté = plafonné à 2/10,
     `accepted = false`, correction imposée. Champ `GenesisMockup.annotations`.

3. **Juge illisible ≠ 0/10.** `parseJudgeScores()` lit les sous-scores clé par clé
   sur une réponse tronquée, `maxOutputTokens` 1400 → 3000, `fixes` extraits
   séparément. Faute de lecture : `score: -1` (« non jugé »), jamais accepté,
   exclu des comparaisons de progression et du choix de la base de retouche.

### Résultats mesurés (même brief chaussures pour comparer)
| run | rendus | non jugés | disqualifiés annotations | meilleur | validé | durée |
|-----|--------|-----------|--------------------------|----------|--------|-------|
| r10 | 10 | 9 | — (contrôle absent) | 4,2/10 | non | 545 s |
| r11 | 11 | 0 | — (contrôle absent) | 6,2/10 | non | 701 s |
| r12 | 10 | 0 | 1 (« ligne de mesure ») | **8,8/10** | **oui** | 639 s |

Reste ouvert : `resynchronisation du scene graph KO: JSON illisible` sur r12
(patch P4D non appliqué), et le builder de site produit toujours 1 page / 1 section.

## R13 — visualisation « ça doit ressembler à un site »

Modifs dans `packages/web/src/api/genesis.ts` uniquement :
- A. `hexToColourName()` : les hex ne sont plus effacés du prompt d'image mais traduits en noms de couleur précis (avant : effacés → rendus gris/ternes).
- B. `P4B_SYSTEM` : anatomie obligatoire de page web (barre de nav ancrée avec lockup + 4-5 entrées + bouton, accroche décalée, PREUVE DE DÉFILEMENT coupée par le bord bas, ≥ 2 composants d'UI réels, micro-textes) + bloc « UNE PAGE PARMI PLUSIEURS » + bloc finition (échelle typo ≥ 1:6, lignes d'alignement, un seul accent).
- C. `MOCKUP_PALETTES` : 10 registres chromatiques francs au lieu des anciens.
- D. Nouvelle phase d'identité (`BRAND_IDENTITY_SYSTEM`, CREATIVE_MODEL) : le moteur décide le LOGOTYPE (caractère, casse, traçage, signe ou aucun, usage nav/pied, interdits), verrouillé avec le nom via `identityLock` et propagé partout où `nameLock` l'est. Champ `GenesisResult.brandIdentity`.

Résultat run r13 (`scripts/genesis-mockup-r13.ts`, log `/tmp/mock13.log`) :
- marque décidée : « Solen Run », logotype = grotesque néo-humaniste, bas de casse.
- 10 rendus, 0 non jugé, 0 disqualifié pour annotations, meilleur 7.7/10 → NON validé (seuil 8 + tous critères ≥ 6), 660 s.
- Sorties : `/home/user/genesis-mockups-r13/01-chaussures/`.
- tsc 0 erreur, `bun run build` vert, non-régressions vertes (`· 15 steps`, `GENESIS ROWS ... Réflexion en cours`, `no beta gate`).

Reste à faire : F. questions au démarrage du run dans le chat (nom, couleurs, style, pages) — non commencé ; E. redescente des tokens de design dans le Scene Graph pour les pages suivantes ; `resynchronisation du scene graph KO: JSON illisible` toujours présent.

## R14 — baisse du coût/durée + verrouillage de goût "planche B"

Modifs (`packages/web/src/api/genesis.ts`) :
- Plafonds : TRIES 3→2, ROUNDS 2→1, RENDERS 11→4, `GENESIS_MOCKUP_BATCH = 3` désormais câblé (`axes.slice(0, 3)`).
- `detectWorkAnnotations()` n'est plus appelé qu'au-dessus de 6/10 (1 passe de vision au lieu de 2 par rendu).
- `MOCKUP_PALETTES` réécrit : 6 registres calqués sur la planche B.
- `TASTE_LOCK` (texte) injecté dans les 3 prompts de maquette : 3 familles autorisées (sombre lumineux / suisse strict / photo dominante), interdits explicites (collage multicolore, pastels/beiges, cartes arrondies en grille, typo décorative, >1 accent).
- Réécritures de prompt 2 et 3 passées de opus à sonnet.

Résultat mesuré (même brief chaussures) : marque « Forme Nette », **4 rendus, meilleur 6.3/10, NON validé, 454 s** (r13 : 10 rendus, 7.7/10, 660 s).
tsc 0 erreur, `bun run build` vert.

Problème restant : les 4 rendus sortent en os/béton/crème — aucune des 3 familles de la planche B. Le `TASTE_LOCK` est écrasé en amont par la phase « registre sensoriel » / identité de marque qui verrouille sa propre palette avant le tirage de `MOCKUP_PALETTES`.

## R15 — porte de choix : l'utilisateur clique la maquette qu'il préfère

- `genesis.ts` : nouveaux types `GenesisChoiceOption` / `GenesisChoiceReply`, registre `pendingChoices`, `submitGenesisChoice()`, `hasPendingGenesisChoice()`, événements SSE `choice` et `choice_done`, option `interactive` dans `RunGenesisOptions`.
- Après chaque planche parallèle, le moteur s'arrête et attend (10 min max) : clic sur une proposition = validation (prime sur le juge, `chosenByUser: true`, scene graph patché) ; texte libre = nouvelle planche avec la demande injectée en tête de prompt (`DEMANDE EXPLICITE DU CLIENT`). Jusqu'à 4 planches (`GENESIS_MAX_CHOICE_ROUNDS`), 3 propositions chacune. Délai dépassé = le moteur reprend la main sur le meilleur score.
- `api/index.ts` : route `POST /api/genesis/choose` ({ runId, pick } ou { runId, prompt }), `interactive: true` par défaut sur `/genesis/stream`.
- `GenesisPanel.tsx` : `GenesisChoiceState` ajouté à `GenesisRunState`.
- `chat.tsx` : grille de propositions cliquables (survol « Choisir celle-ci »), champ « dis-moi ce que tu veux voir à la place » + bouton « Autre planche », `sendGenesisChoice()`.

Vérifié : tsc 0 erreur, `bun run build` vert, dev 4200 `{"status":"ok"}`, `POST /api/genesis/choose` répond 409 sur un runId inconnu (route bien montée). Non vérifié : aucun run `/genesis` complet relancé depuis, donc le clic réel n'a pas encore été essayé de bout en bout.

## R16 — Design system verrouillé depuis la maquette choisie (multi-pages)

- `packages/web/src/api/genesis.ts` : `DESIGN_SYSTEM_SYSTEM` + `extractDesignSystem(dataUrl, brandName)`
  → 1 passe de vision (`VISION_MODEL`) sur la maquette retenue/cliquée, JSON strict :
  palette hex, polices + sources, échelle typo, grille/densité, nav, boutons, rayon,
  filets, cartes, footer, traitement des images, durées/easings, interdits.
- `GenesisResult.designSystem` ajouté ; renseigné dans le retour final, `""` en mode `mockupOnly`.
- `designLock` (« DESIGN SYSTEM VERROUILLÉ — S'APPLIQUE À CHAQUE PAGE ») injecté dans le
  prompt de Phase 8 + règle multi-pages, et préfixé en tête de la spec renvoyée.
- `packages/web/src/web/pages/chat.tsx` : bloc « SYSTÈME DE DESIGN COMMUN À TOUTES LES PAGES »
  ajouté au brief caché de construction (variables CSS, composants partagés, toutes les
  pages atteignables, aucune dérive de couleur/police/rayon).

Vérifié : tsc 0 erreur, build vert, /api/health ok, 3 non-régressions vertes
(15 steps · GENESIS ROWS Réflexion en cours · no beta gate).
Non vérifié : aucun run /genesis complet relancé (coût/durée) — l'effet réel sur le
site multi-pages n'est pas mesuré.
