import React, { useEffect, useRef, useState, useMemo, useCallback, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useParams, useLocation } from 'wouter';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useSidebar } from '../lib/sidebar';
import { BRAND, TIER_MAX, TIER_PRO, TIER_LITE } from '../lib/brand';
import { needsPreview, buildContinueMessage, CONTINUE_STORAGE_KEY, type ContinueConfig } from '../lib/specialists';
import { VelbazIcon, detectIconState } from '../components/VelbazIcon';
import { AnalyzingImageIndicator } from '../components/AnalyzingImage';
import { useBuildStore } from '../lib/build-store';
import { ProjectTabs } from '../components/ProjectTabs';
import { PanelToggleButton } from '../components/PanelToggleButton';
import { useVoiceInput } from '../lib/use-voice-input';
import { useIsMobile } from '../lib/useIsMobile';
import { VoiceMicButton, VoiceOverlay } from '../components/VoiceMic';
import { AIApprovalPopup, isAIApprovalEnabled } from '../components/AIApprovalPopup';
import { SocialConnectPanel } from '../components/SocialConnectPanel';
import { QuestionTool, type QuestionConfig } from '../components/QuestionTool';
import { PagePlanTool } from '../components/PagePlanTool';
import { CalendarView, type CalViewData } from '../components/CalendarView';
import { TableView, type TableViewData } from '../components/TableView';
import { ChartView, type ChartViewData } from '../components/ChartView';
import CoinChartView, { type CoinChartViewData } from '../components/CoinChartView';
import PredictionView, { type PredictionViewData } from '../components/PredictionView';
import NewSpecialistCard, { type NewSpecialistData } from '../components/NewSpecialistCard';
import { StatsView, type StatsViewData } from '../components/StatsView';
import { CardView, type CardViewData } from '../components/CardView';
import { StepsView, type StepsViewData } from '../components/StepsView';
import { AlertView, type AlertViewData } from '../components/AlertView';
import { AccordionView, type AccordionViewData } from '../components/AccordionView';
import { RichView, type RichViewData } from '../components/RichView';
import { PricingView, type PricingViewData } from '../components/PricingView';
import { AudioView, type AudioViewData } from '../components/AudioView';
import { MapView, type MapViewData } from '../components/MapView';
import { MessagePreview, type MessageViewData } from '../components/MessagePreview';
import { SocialPreview, type SocialViewData } from '../components/SocialPreview';
import { ContactView, type ContactViewData } from '../components/ContactView';
import { ReviewView, type ReviewViewData } from '../components/ReviewView';
import { PlanView, type PlanViewData } from '../components/PlanView';
import { AIPopup, type PopupConfig, isBlockingPopup } from '../components/AIPopup';
import { CommandChip, filterSlashCommands, SlashMenuShell, SlashRow } from '../components/SlashMenu';
import { PANEL_CARD } from '../lib/panel-card';
import { ProductVisualizerPopup } from '../components/ProductVisualizerPopup';
import { InventionVisualizerPopup } from '../components/InventionVisualizerPopup';
import { BrandPreviewPopup } from '../components/BrandPreviewPopup';
import TeamConversation, { type TeamMsg } from '../components/TeamConversation';
import { HiggsfieldStudio } from '../components/HiggsfieldStudio';
import AutopilotTaskPanel from '../components/AutopilotTaskPanel';

/** Extract a [POPUP]{json}[/POPUP] block from an AI reply. Returns the parsed
 *  config plus the text with the block removed, or null when absent/invalid. */
function extractPopup(text: string): { popup: PopupConfig; rest: string } | null {
  const m = text.match(/\[POPUP\]([\s\S]*?)\[\/POPUP\]/) || text.match(/\[POPUP\]([\s\S]*)$/);
  if (!m) return null;
  let jsonStr = m[1].replace(/\[\/POPUP\].*$/, '').trim();
  const first = jsonStr.indexOf('{');
  const last = jsonStr.lastIndexOf('}');
  if (first === -1 || last <= first) return null;
  jsonStr = jsonStr.substring(first, last + 1);
  let parsed: any;
  try { parsed = JSON.parse(jsonStr); } catch {
    let r = jsonStr;
    const q = (r.match(/"/g) || []).length; if (q % 2 !== 0) r += '"';
    const ob = (r.match(/\{/g) || []).length, cb = (r.match(/\}/g) || []).length;
    for (let i = 0; i < ob - cb; i++) r += '}';
    try { parsed = JSON.parse(r); } catch { return null; }
  }
  const valid = ['confirm', 'preview', 'choice', 'alert', 'progress', 'secret', 'delete_secret', 'recap', 'info', 'product_preview', 'invention_preview', 'brand_preview', 'printify_design'];
  if (!parsed || typeof parsed !== 'object' || !valid.includes(parsed.type)) return null;
  const rest = text
    .replace(/\[POPUP\][\s\S]*?\[\/POPUP\]/g, '')
    .replace(/\[POPUP\][\s\S]*$/g, '')
    .trim();
  return { popup: parsed as PopupConfig, rest };
}
import { EditTool } from '../components/EditTool';
import { LinkPreview } from '../components/LinkPreview';
import { ColorPreview } from '../components/ColorPreview';
import { ImagePreview } from '../components/ImagePreview';
import CodePanel from '../components/CodePanel';
import OrdersPanel from '../components/OrdersPanel';
import PhonePreviewPanel from '../components/PhonePreviewPanel';
import IPhoneMockup from '../components/IPhoneMockup';
import { GenesisPanel, emptyGenesisRun, type GenesisRunState } from '../components/GenesisPanel';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  time: Date;
  isBuildStep?: boolean;
  reasoning?: string;
  attachments?: { name: string; type: string; previewUrl?: string }[];
}

// Robustly parse a chat message timestamp. The API serializes the Drizzle
// `timestamp` column as an ISO string under `createdAt`; older/other shapes
// may send `created_at` as unix seconds. Fall back to now if unparseable so a
// bad timestamp never collapses to epoch 0 and reorders the conversation.
function parseMsgTime(m: any): Date {
  if (m?.createdAt != null) {
    const d = new Date(m.createdAt);
    if (!isNaN(d.getTime())) return d;
  }
  if (m?.created_at != null) {
    const n = Number(m.created_at);
    if (!isNaN(n) && n > 0) return new Date(n < 1e12 ? n * 1000 : n);
    const d = new Date(m.created_at);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  data: string; // full data URI
  size: number;
  type: 'image' | 'document' | 'text';
  previewUrl?: string; // object URL for images
}

/* ─── Website Build Live Preview ─── */
function WebsiteLoadingSkeleton({ progress, currentTask, parallelCount, companyId, building }: { progress: number; currentTask: string; parallelCount: number; companyId?: string; building?: boolean }) {
  const [builtPages, setBuiltPages] = useState<Array<{ slug: string; title: string; htmlContent: string }>>([]);
  const [activeThumb, setActiveThumb] = useState<string | null>(null);
  const seenSlugsRef = useRef(new Set<string>());
  const [newPageSlug, setNewPageSlug] = useState<string | null>(null);
  // Tracks whether the user manually picked a page — once they do, the
  // poller must never override their choice, not even when a new page
  // finishes building in the background.
  const userPickedRef = useRef(false);
  // ── Preview EN DIRECT (Vite/React) ──────────────────────────────────────────
  // Pour les projets React/Vite, le backend démarre le serveur de preview dès
  // que l'ossature est prête (bien avant la fin du build). Les pages ne sont
  // PLUS écrites en DB avec du htmlContent → le skeleton restait figé pour
  // toujours. On sonde donc build-status: dès qu'un serveur tourne, on bascule
  // sur l'iframe /preview/ et l'utilisateur voit le site se construire EN DIRECT
  // (HMR de Vite). On ne fait que LIRE le statut (jamais /preview/start).
  const [liveSrc, setLiveSrc] = useState<string | null>(null);
  // AUCUN rechargement automatique de l'iframe : demande explicite de
  // l'utilisateur — le preview ne doit JAMAIS se réactualiser tout seul
  // pendant que l'IA travaille. On ne fait que détecter la première
  // disponibilité du serveur pour afficher l'iframe une seule fois.
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/companies/${companyId}/build-status`, { headers: authHeaders() });
        const data = await res.json();
        if (cancelled) return;
        const serverUp = data.status === 'completed' || !!data.previewUrl;
        if (serverUp && !liveSrc) {
          setLiveSrc(`/api/companies/${companyId}/preview/`);
        }
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 2500);
    return () => { cancelled = true; clearInterval(iv); };
  }, [companyId, liveSrc]);

  // Poll for newly built pages during the build
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await api.companies.pages(companyId);
        if (cancelled) return;
        const allPages = (res.pages || []).filter((p: any) => p.htmlContent);
        // Deduplicate by slug — keep the first language variant (default lang comes first from sort order)
        const seenSlug = new Set<string>();
        const pages = allPages.filter((p: any) => {
          if (seenSlug.has(p.slug)) return false;
          seenSlug.add(p.slug);
          return true;
        });
        // Detect new pages and auto-switch to the newest one — but only
        // while the user hasn't manually picked a page themselves.
        let latestNewSlug: string | null = null;
        for (const p of pages) {
          if (!seenSlugsRef.current.has(p.slug)) {
            seenSlugsRef.current.add(p.slug);
            latestNewSlug = p.slug;
          }
        }
        if (latestNewSlug && !userPickedRef.current) {
          setNewPageSlug(latestNewSlug);
          setActiveThumb(latestNewSlug); // auto-switch preview to new page
          setTimeout(() => setNewPageSlug(null), 1200);
        }
        setBuiltPages(pages);
        // Initial selection (only before the user has picked anything)
        if (pages.length > 0 && !activeThumb && !latestNewSlug && !userPickedRef.current) {
          setActiveThumb(pages[0].slug);
        }
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [companyId]);

  const activePage = builtPages.find(p => p.slug === activeThumb);

  return (
    <div className="w-full h-full flex flex-col" style={{ background: 'var(--surface-0)' }}>
      {/* Main area: live Vite preview (React) > built DB page (legacy) > skeleton */}
      <div className="flex-1 overflow-hidden relative">
        {liveSrc ? (
          /* Preview EN DIRECT du serveur Vite : le site se construit sous les yeux
             de l'utilisateur (HMR). Interactif (pointer-events actifs). */
          <iframe
            src={liveSrc}
            className="w-full h-full page-preview-enter"
            style={{ border: 'none' }}
            title="Live preview"
          />
        ) : activePage ? (
          <iframe
            key={activePage.slug}
            srcDoc={activePage.htmlContent}
            className="w-full h-full page-preview-enter"
            style={{ border: 'none', pointerEvents: 'none' }}
            title={`Preview: ${activePage.title}`}
            sandbox="allow-same-origin"
          />
        ) : (
          /* Skeleton while no pages built yet — the Dino mini-game is a
             transparent overlay that runs directly over THESE SAME rectangles
             (no separate game box, no extra background). */
          <div className="p-6 space-y-6 animate-fade-in relative">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="skeleton-bar h-4 rounded" style={{ width: 120 }} />
              <div className="flex gap-4">
                <div className="skeleton-bar h-3 rounded" style={{ width: 50 }} />
                <div className="skeleton-bar h-3 rounded" style={{ width: 50 }} />
                <div className="skeleton-bar h-7 rounded-md" style={{ width: 80 }} />
              </div>
            </div>
            <div className="flex flex-col items-center gap-4 py-10 px-8">
              <div className="skeleton-bar h-8 rounded" style={{ width: '75%' }} />
              <div className="skeleton-bar h-8 rounded" style={{ width: '55%' }} />
              <div className="skeleton-bar h-4 rounded" style={{ width: '60%', marginTop: 8 }} />
              <div className="flex gap-3 mt-4">
                <div className="skeleton-bar h-10 rounded-lg" style={{ width: 130 }} />
                <div className="skeleton-bar h-10 rounded-lg" style={{ width: 110 }} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 px-6 mt-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="p-5 rounded-xl space-y-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
                  <div className="skeleton-bar h-8 w-8 rounded-lg" />
                  <div className="skeleton-bar h-4 rounded" style={{ width: '70%' }} />
                  <div className="skeleton-bar h-3 rounded" style={{ width: '90%' }} />
                </div>
              ))}
            </div>
            <div className="build-shimmer-sweep" />
          </div>
        )}

        {/* Live building indicator overlay — only while the AI is actually working */}
        {building !== false && (
          <div className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)', zIndex: 10 }}>
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#D0D0D0' }} />
            <span className="text-[11px] font-medium" style={{ color: '#fff' }}>Building live...</span>
          </div>
        )}
      </div>

      {/* Page thumbnails strip */}
      {builtPages.length > 0 && (
        <div className="shrink-0 px-3 py-2 flex gap-2 overflow-x-auto" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-subtle)' }}>
          {builtPages.map((p) => (
            <button
              key={p.slug}
              onClick={() => { userPickedRef.current = true; setActiveThumb(p.slug); }}
              className={`shrink-0 rounded-md overflow-hidden transition-all duration-300 ${newPageSlug === p.slug ? 'page-thumb-enter' : ''}`}
              style={{
                width: 100, height: 64,
                border: activeThumb === p.slug ? '2px solid var(--purple)' : '1px solid var(--border-default)',
                opacity: activeThumb === p.slug ? 1 : 0.6,
                transform: activeThumb === p.slug ? 'scale(1.05)' : 'scale(1)',
                position: 'relative',
              }}
              title={p.title}
            >
              <iframe
                srcDoc={p.htmlContent}
                style={{ width: 1280, height: 820, transform: 'scale(0.078)', transformOrigin: 'top left', pointerEvents: 'none', border: 'none', display: 'block' }}
                tabIndex={-1}
                sandbox="allow-same-origin"
              />
              <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
                <span className="text-[8px] font-medium truncate block" style={{ color: '#fff' }}>{p.title}</span>
              </div>
            </button>
          ))}
          {/* Placeholder slots for pages not yet built */}
          {progress < 90 && [1, 2, 3].slice(0, Math.max(0, 3 - builtPages.length)).map(i => (
            <div key={`ph-${i}`} className="shrink-0 rounded-md overflow-hidden" style={{ width: 100, height: 64, background: 'var(--surface-3)', border: '1px dashed var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="w-3 h-3 border border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--text-ghost)', borderTopColor: 'transparent' }} />
            </div>
          ))}
        </div>
      )}

      {/* Bottom: current task + progress bar */}
      <div className="shrink-0 px-4 pb-3 pt-2" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-subtle)' }}>
        <p className="text-[11px] mb-2 truncate" style={{ color: 'var(--text-dim)' }}>
          {currentTask || 'AI is working...'}
        </p>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-medium" style={{ color: 'var(--text-dim)' }}>
            {builtPages.length > 0 ? `${builtPages.length} page${builtPages.length > 1 ? 's' : ''} built` : parallelCount > 1 ? `${parallelCount} tasks in parallel` : 'Building...'}
          </span>
          <span className="text-[10px] font-mono" style={{ color: 'var(--text-ghost)' }}>{progress}%</span>
        </div>
        <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--surface-4)' }}>
          <div className="h-full rounded-full transition-all duration-1000 ease-out build-progress-bar"
            style={{ width: `${Math.max(3, progress)}%` }} />
        </div>
      </div>
    </div>
  );
}

/* Auth headers pour les fetch directs (l'auth passe par Bearer token, PAS par cookie) */
function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('velbaz_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/* ─── Bouton "Export to GitHub" (repo privé) ─── */
function GithubExportButton({ companyId, projectName }: { companyId: string; projectName?: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle');
  const [repoUrl, setRepoUrl] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [repoName, setRepoName] = useState<string>('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  // Slugifie côté client pour montrer à l'utilisateur le vrai nom du repo.
  const slugify = (s: string) =>
    (s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 90);

  // À l'ouverture : préremplit avec le nom du projet et focus l'input.
  const openPopup = useCallback(() => {
    setRepoName(prev => prev || slugify(projectName || ''));
    setState('idle');
    setMessage('');
    setRepoUrl('');
    setOpen(true);
    setTimeout(() => inputRef.current?.select(), 40);
    // Récupère le vrai nom du projet si on ne l'a pas déjà, pour préremplir.
    if (!projectName) {
      api.companies.get(companyId)
        .then((res: any) => {
          const nm = res?.company?.name || res?.name;
          if (nm) setRepoName(prev => prev || slugify(nm));
        })
        .catch(() => { /* ignore : l'utilisateur tape le nom lui-même */ });
    }
  }, [projectName, companyId]);

  // Ferme la popup si on clique en dehors (sauf pendant l'export).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.MouseEvent) => {
      if (state === 'exporting') return;
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, state]);

  const finalSlug = slugify(repoName) || 'velbaz-project';

  const handleExport = useCallback(async () => {
    if (state === 'exporting') return;
    setState('exporting');
    setMessage('');
    setRepoUrl('');
    try {
      const res = await fetch(`/api/companies/${companyId}/export-github`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoName: finalSlug }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (res.ok && data?.ok) {
        setRepoUrl(data.repoUrl || '');
        setState('done');
        setMessage(data.created ? 'Private repo created ✓' : 'Repo updated ✓');
      } else {
        setState('error');
        if (data?.error === 'github_not_configured') {
          setMessage("GitHub API key missing — add GITHUB_TOKEN in .env to enable export.");
        } else if (data?.error === 'github_bad_token') {
          setMessage('Invalid GitHub token (401). Check GITHUB_TOKEN.');
        } else if (data?.error === 'no_files') {
          setMessage('No files to export for this project.');
        } else if (data?.error === 'github_create_failed') {
          setMessage('Repo creation refused by GitHub. ' + (data?.detail || ''));
        } else {
          setMessage('Export failed. ' + (data?.detail || data?.error || ''));
        }
      }
    } catch {
      setState('error');
      setMessage('Network error during export.');
    }
  }, [companyId, state, finalSlug]);

  return (
    <div style={{ position: 'relative', display: 'flex' }}>
      <button
        onClick={() => (open ? setOpen(false) : openPopup())}
        title="Export this project to a private GitHub repo"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
          background: open ? 'var(--surface-3)' : 'var(--surface-1)', color: 'var(--text-dim)',
          border: '1px solid var(--border-subtle)', cursor: 'pointer', transition: 'all 0.15s',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 2.5-.34c.85 0 1.71.12 2.5.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.35 4.79-4.58 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.59.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" />
        </svg>
        Export to GitHub
      </button>

      {open && (
        <div
          ref={popRef}
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 70,
            width: 300, padding: 14, borderRadius: 10,
            background: 'var(--surface-0)', border: '1px solid var(--border-default)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="var(--text-secondary)" aria-hidden>
              <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 2.5-.34c.85 0 1.71.12 2.5.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.35 4.79-4.58 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.59.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Export to GitHub</span>
          </div>

          <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text-ghost)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>
            Project name (repo)
          </label>
          <input
            ref={inputRef}
            value={repoName}
            onChange={(e) => { setRepoName(e.target.value); if (state !== 'idle') { setState('idle'); setMessage(''); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' && finalSlug && state !== 'exporting') handleExport(); }}
            placeholder="mon-projet"
            disabled={state === 'exporting'}
            style={{
              width: '100%', padding: '7px 10px', fontSize: 12,
              background: 'var(--surface-2)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)', borderRadius: 7, outline: 'none',
            }}
          />
          <div style={{ fontSize: 10, color: 'var(--text-ghost)', marginTop: 5 }}>
            Private repo: <span style={{ color: 'var(--text-dim)', fontFamily: 'monospace' }}>{finalSlug}</span>
          </div>

          {message && (
            <div
              style={{
                marginTop: 10, padding: '8px 10px', borderRadius: 7, fontSize: 11, lineHeight: 1.4,
                background: state === 'done' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                color: state === 'done' ? '#10b981' : '#ef4444',
              }}
            >
              {message}
              {repoUrl && (
                <button type="button" onClick={() => window.open(repoUrl, '_blank', 'noopener,noreferrer')}
                  style={{ display: 'block', marginTop: 6, color: '#3b82f6', textDecoration: 'none', fontWeight: 600, wordBreak: 'break-all', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                  Open repo ↗
                </button>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              onClick={() => setOpen(false)}
              disabled={state === 'exporting'}
              style={{
                flex: 1, padding: '7px 0', fontSize: 11, fontWeight: 600, borderRadius: 7,
                background: 'var(--surface-2)', color: 'var(--text-dim)',
                border: '1px solid var(--border-subtle)', cursor: state === 'exporting' ? 'default' : 'pointer',
              }}
            >
              {state === 'done' ? 'Close' : 'Cancel'}
            </button>
            <button
              onClick={handleExport}
              disabled={state === 'exporting' || !finalSlug}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '7px 0', fontSize: 11, fontWeight: 700, borderRadius: 7,
                background: 'var(--blue-accent)', color: '#fff', border: 'none',
                cursor: state === 'exporting' || !finalSlug ? 'default' : 'pointer',
                opacity: state === 'exporting' || !finalSlug ? 0.7 : 1,
              }}
            >
              {state === 'exporting' && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              )}
              {state === 'exporting' ? 'Export…' : state === 'done' ? 'Re-export' : 'Export'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Website Preview Panel (iframe) ─── */
// ─── Carte de résultat de travail (aperçu figé + Continuer + Rollback) ───────
// Rendue SOUS chaque build/édition terminé dans le chat. Contient :
//  1. un mini-aperçu LIVE et figé (rectangle web ou petit iPhone mobile),
//     non-interactif à l'intérieur mais CLIQUABLE → ouvre le site/app en
//     nouvel onglet, montrant toujours l'état actuel du projet ;
//  2. « Continuer dans un autre projet » → fork indépendant (nouveau projet) ;
//  3. « Rollback » → remet le projet à l'état de ce checkpoint (historique
//     conservé, redo possible).
function WorkResultCard({
  companyId, isPhone, checkpoint, isLatest, onForked, onRolledBack, onOpenPreview,
}: {
  companyId: string;
  isPhone: boolean;
  checkpoint: { id: string; label: string; kind?: string };
  isLatest?: boolean;
  onForked: (newId: string, name: string) => void;
  onRolledBack: (label: string) => void;
  onOpenPreview?: () => void;
}) {
  const [forking, setForking] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Chargement du mini-aperçu : reste affiché tant que le contenu n'est pas
  // réellement prêt (le serveur peut être en train de se relancer/auto-heal).
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string>('');
  const retryCountRef = useRef(0);

  // Ferme le menu au clic extérieur.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);
  const previewUrl = isPhone
    ? `/api/companies/${companyId}/mobile-preview/`
    : `/api/companies/${companyId}/preview/`;

  // (Ré)initialise la source de l'aperçu quand le projet change.
  useEffect(() => {
    retryCountRef.current = 0;
    setPreviewLoaded(false);
    setPreviewSrc(`${previewUrl}?t=${Date.now()}`);
  }, [previewUrl]);

  // Après chargement, vérifie que ce n'est pas une page d'erreur du proxy
  // (serveur en train de se relancer / pas encore prêt) → réessaie avec un
  // spinner, au lieu d'afficher une erreur figée.
  const handlePreviewLoad = useCallback(() => {
    let mountAttempts = 0;
    const check = () => {
      let isError = false;
      let hasContent = false;
      try {
        const doc = iframeRef.current?.contentDocument;
        const text = (doc?.body?.innerText || '').trim();
        if (/Preview proxy error|Preview not running|no_files|Redémarrage de l'aperçu|Redémarrage de l’aperçu/i.test(text)) isError = true;
        const root = doc?.getElementById('root') || doc?.body;
        hasContent = !!(root && (root.children.length > 0 || text.length > 0));
      } catch {}
      if (isError && retryCountRef.current < 20) {
        retryCountRef.current += 1;
        setTimeout(() => setPreviewSrc(`${previewUrl}?t=${Date.now()}`), 1500);
        return;
      }
      // Le HTML se charge avant que React n'ait fini de monter l'app —
      // on attend un peu que le contenu réel apparaisse avant de révéler
      // l'aperçu (sinon on montre une page blanche pendant l'hydratation).
      if (!hasContent && mountAttempts < 14) {
        mountAttempts += 1;
        setTimeout(check, 300);
        return;
      }
      setPreviewLoaded(true);
    };
    check();
  }, [previewUrl]);

  const doFork = useCallback(async () => {
    if (forking) return;
    setForking(true); setErr(null);
    try {
      const res = await api.companies.fork(companyId);
      if (res?.id) onForked(res.id, res.name || 'Project copy');
      else setErr(res?.error || 'Copy failed');
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setForking(false); }
  }, [companyId, forking, onForked]);

  const doRollback = useCallback(async () => {
    if (rolling) return;
    setRolling(true); setErr(null);
    try {
      const res = await api.companies.rollback(companyId, checkpoint.id);
      if (res?.ok) onRolledBack(checkpoint.label);
      else setErr(res?.error || 'Rollback failed');
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setRolling(false); }
  }, [companyId, checkpoint.id, checkpoint.label, rolling, onRolledBack]);

  return (
    <div className="pl-7 my-2">
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: 'var(--surface-3)', border: '1px solid var(--surface-4)', maxWidth: 600, width: '100%' }}
      >
        {/* En-tête */}
        <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <span className="text-[12.5px] font-medium truncate" style={{ color: 'var(--text-secondary)' }}>{checkpoint.label || 'Work done'}</span>
        </div>

        {/* Preview live figé, cliquable → ouvre en nouvel onglet.
            IMPORTANT : on utilise un vrai lien <a target="_blank"> et non
            window.open() dans un onClick — window.open() est bloqué par les
            bloqueurs de popup et par le sandbox de l'iframe de prévisualisation.
            Un clic sur un <a> est une navigation utilisateur réelle, jamais bloquée. */}
        <a
          href={isPhone
            ? `/api/companies/${companyId}/mobile-preview/`
            : `/api/companies/${companyId}/website`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => { onOpenPreview?.(); }}
          className="group relative block w-full cursor-pointer"
          title="Open site in a new tab"
          style={{ background: 'var(--surface-2)' }}
        >
          {isPhone ? (
            <div className="flex items-center justify-center py-3" style={{ height: 260 }}>
              <div style={{ width: 417 * 0.28, height: 876 * 0.28 }}>
                <IPhoneMockup model="15-pro" color="space-black" scale={0.28} safeArea={false}>
                  <iframe
                    ref={iframeRef}
                    src={previewSrc}
                    title="Mobile preview"
                    tabIndex={-1}
                    className="w-full h-full border-0 bg-black pointer-events-none"
                    style={{ opacity: previewLoaded ? 1 : 0, transition: 'opacity 0.35s ease' }}
                    sandbox="allow-scripts allow-same-origin"
                    scrolling="no"
                    onLoad={handlePreviewLoad}
                  />
                </IPhoneMockup>
              </div>
            </div>
          ) : (
            <div className="relative w-full overflow-hidden" style={{ height: 340 }}>
              <iframe
                ref={iframeRef}
                src={previewSrc}
                title="Site preview"
                tabIndex={-1}
                className="border-0 bg-white pointer-events-none"
                sandbox="allow-scripts allow-same-origin"
                scrolling="no"
                style={{ width: '100%', height: '100%', opacity: previewLoaded ? 1 : 0, transition: 'opacity 0.35s ease' }}
                onLoad={handlePreviewLoad}
              />
            </div>
          )}
          {/* Chargement : reste visible tant que l'aperçu n'est pas prêt
              (premier chargement ou serveur en train de se relancer) */}
          {!previewLoaded && (
            <div className="absolute inset-0" style={{ background: 'var(--surface-2)' }}>
              <div className="preview-loading-glow" />
            </div>
          )}
          {/* Overlay : capte les clics (aperçu non-interactif) + indice visuel */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(0,0,0,0.35)' }}>
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-white px-3 py-1.5 rounded-full" style={{ background: 'rgba(0,0,0,0.55)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18M3 9v10a2 2 0 0 0 2 2h4"/></svg>
              View preview
            </span>
          </div>
          {/* Overlay de chargement pendant copie / rollback */}
          {(forking || rolling) && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(1px)' }}>
              <span className="flex items-center gap-2 text-[12.5px] font-medium text-white px-3.5 py-2 rounded-full" style={{ background: 'rgba(0,0,0,0.65)' }}>
                <svg className="animate-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                {forking ? 'Copying…' : 'Rolling back…'}
              </span>
            </div>
          )}
        </a>

      </div>

      {/* Actions — bouton « ⋯ » SOUS le rectangle, dévoile les choix */}
      <div className="flex items-center gap-2 mt-1.5">
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            disabled={forking || rolling}
            className="flex items-center justify-center rounded-lg transition-colors disabled:opacity-50"
            style={{
              width: 30, height: 30,
              background: menuOpen ? 'var(--surface-4)' : 'transparent',
              color: 'var(--text-secondary)', border: '1px solid var(--surface-4)',
            }}
            title="Options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            {forking || rolling ? (
              <span className="text-[12px]">…</span>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
            )}
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute left-0 bottom-full mb-1.5 rounded-xl overflow-hidden shadow-lg z-20"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--surface-4)', minWidth: 230 }}
            >
              <button
                role="menuitem"
                onClick={() => { setMenuOpen(false); doFork(); }}
                disabled={forking}
                className="w-full flex items-center gap-2 text-[12.5px] font-medium px-3 py-2.5 transition-colors disabled:opacity-50 hover:bg-[var(--surface-4)]"
                style={{ color: 'var(--text-secondary)' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
                {forking ? 'Copying…' : 'Branch'}
              </button>
              {!isLatest && (
                <>
                  <div style={{ height: 1, background: 'var(--surface-4)' }} />
                  <button
                    role="menuitem"
                    onClick={() => { setMenuOpen(false); doRollback(); }}
                    disabled={rolling}
                    className="w-full flex items-center gap-2 text-[12.5px] font-medium px-3 py-2.5 transition-colors disabled:opacity-50 hover:bg-[var(--surface-4)]"
                    style={{ color: 'var(--text-muted)' }}
                    title="Restore project to this state (history preserved)"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
                    {rolling ? '…' : 'Rollback'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {err && <span className="text-[11.5px]" style={{ color: '#e5484d' }}>{err}</span>}
      </div>
    </div>
  );
}

// ── Collaborateurs : avatar de l'utilisateur + bouton « + » → popup d'invitation ──
function collabInitials(nameOrEmail: string): string {
  const s = (nameOrEmail || '').trim();
  if (!s) return '?';
  const parts = s.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

function CollaboratorsButton({ companyId }: { companyId: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState('');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<{ owner: any; collaborators: any[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.companies.collaborators.list(companyId);
      if (res && !res.error) setData({ owner: res.owner, collaborators: res.collaborators || [] });
    } catch { /* ignore */ }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (open) load(); }, [open, load]);

  const doInvite = async () => {
    const value = emails.trim();
    if (!value || inviting) return;
    setInviting(true); setError(null); setNotice(null);
    try {
      const res = await api.companies.collaborators.invite(companyId, value);
      if (res?.error) { setError(res.error); }
      else {
        setEmails('');
        const sent = (res.invited || []).filter((r: any) => r.status).length;
        setNotice(sent ? 'Invitation sent.' : 'Invitation created.');
        await load();
      }
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setInviting(false); }
  };

  const removeCollab = async (id: string) => {
    try { await api.companies.collaborators.remove(companyId, id); await load(); } catch { /* ignore */ }
  };

  const ownerName = data?.owner?.name || user?.name || 'You';
  const ownerEmail = data?.owner?.email || user?.email || '';
  const accepted = (data?.collaborators || []).filter((c: any) => c.status === 'accepted');

  return (
    <>
      {/* Pile d'avatars + bouton « + » dans la barre d'outils de l'aperçu */}
      <div className="flex items-center" style={{ marginLeft: 2 }}>
        <div
          className="flex items-center justify-center rounded-full shrink-0"
          title={`${ownerName}${ownerEmail ? ` — ${ownerEmail}` : ''}`}
          style={{ width: 26, height: 26, background: 'var(--surface-5)', color: 'var(--text-secondary)', fontSize: 10, fontWeight: 600, border: '1.5px solid var(--surface-2)' }}
        >
          {collabInitials(ownerName || ownerEmail)}
        </div>
        {accepted.map((cslab: any) => (
          <div
            key={cslab.id}
            className="flex items-center justify-center rounded-full shrink-0"
            title={`${cslab.name || cslab.email}`}
            style={{ width: 26, height: 26, marginLeft: -8, background: 'var(--purple, #6366F1)', color: '#fff', fontSize: 10, fontWeight: 600, border: '1.5px solid var(--surface-2)' }}
          >
            {collabInitials(cslab.name || cslab.email)}
          </div>
        ))}
        <button
          onClick={() => setOpen(true)}
          title="Invite collaborators"
          className="flex items-center justify-center rounded-full shrink-0 transition-colors"
          style={{ width: 26, height: 26, marginLeft: -8, background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1.5px solid var(--surface-4)', cursor: 'pointer' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>

      {/* Popup d'invitation */}
      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="rounded-2xl shadow-2xl"
            style={{ width: '100%', maxWidth: 560, background: 'var(--surface-1)', border: '1px solid var(--surface-4)', padding: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-[17px] font-semibold" style={{ color: 'var(--text-primary)' }}>Invite collaborators</h2>
                <p className="text-[13px] mt-1" style={{ color: 'var(--text-dim)' }}>Give others access to edit this application.</p>
              </div>
              <button onClick={() => setOpen(false)} className="p-1 rounded-md" style={{ color: 'var(--text-dim)', background: 'transparent', border: 'none', cursor: 'pointer' }} title="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="flex items-center gap-2 mt-5">
              <input
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') doInvite(); }}
                placeholder="Enter emails, separated by commas"
                className="flex-1 h-11 rounded-lg px-3.5 text-[13px] outline-none"
                style={{ background: 'var(--surface-2)', color: 'var(--text-primary)', border: '1px solid var(--surface-4)' }}
              />
              <button
                onClick={doInvite}
                disabled={inviting || !emails.trim()}
                className="h-11 px-5 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-50"
                style={{ background: emails.trim() ? 'var(--purple, #6366F1)' : 'var(--surface-4)', color: emails.trim() ? '#fff' : 'var(--text-dim)', border: 'none', cursor: emails.trim() ? 'pointer' : 'default' }}
              >
                {inviting ? '…' : 'Invite'}
              </button>
            </div>
            {error && <p className="text-[12px] mt-2" style={{ color: '#e5484d' }}>{error}</p>}
            {notice && <p className="text-[12px] mt-2" style={{ color: '#30a46c' }}>{notice}</p>}

            <div className="mt-6">
              <p className="text-[13px] font-medium mb-2.5" style={{ color: 'var(--text-secondary)' }}>Application collaborators</p>
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--surface-4)' }}>
                {/* Owner */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex items-center justify-center rounded-full shrink-0" style={{ width: 34, height: 34, background: 'var(--surface-5)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600 }}>
                    {collabInitials(ownerName || ownerEmail)}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[13.5px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{ownerName} {data?.owner?.isYou !== false && <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(You)</span>}</span>
                    <span className="text-[12px] truncate" style={{ color: 'var(--text-dim)' }}>{ownerEmail}</span>
                  </div>
                  <span className="text-[13px] shrink-0" style={{ color: 'var(--text-dim)' }}>Owner</span>
                </div>
                {/* Collaborateurs invités */}
                {(data?.collaborators || []).map((cslab: any) => (
                  <div key={cslab.id} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--surface-4)' }}>
                    <div className="flex items-center justify-center rounded-full shrink-0" style={{ width: 34, height: 34, background: 'var(--purple, #6366F1)', color: '#fff', fontSize: 12, fontWeight: 600 }}>
                      {collabInitials(cslab.name || cslab.email)}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-[13.5px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{cslab.name || cslab.email}{cslab.isYou && <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}> (You)</span>}</span>
                      <span className="text-[12px] truncate" style={{ color: 'var(--text-dim)' }}>{cslab.email}</span>
                    </div>
                    <span className="text-[12px] shrink-0 mr-2" style={{ color: cslab.status === 'accepted' ? '#30a46c' : 'var(--text-dim)' }}>{cslab.status === 'accepted' ? 'Editor' : 'Pending'}</span>
                    <button onClick={() => removeCollab(cslab.id)} title="Remove" className="p-1 rounded-md shrink-0" style={{ color: 'var(--text-dim)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 mt-5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              <span className="text-[12px]" style={{ color: 'var(--text-dim)' }}>All collaborators consume workspace credits.</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function WebsitePreview({ companyId, refreshKey, onSlugChange }: { companyId: string; refreshKey?: number; onSlugChange?: (slug: string) => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  // Combien de fois on a réessayé après avoir détecté une page d'erreur du
  // proxy (serveur en train de se relancer / dev server pas encore prêt).
  const previewRetryRef = useRef(0);
  const build = useBuildStore();
  const prevWebsiteReady = useRef(false);
  const refreshCountRef = useRef(0);
  const [currentSlug, setCurrentSlug] = useState('index');
  const [pages, setPages] = useState<{slug: string; title: string}[]>([]);
  const [showPagePicker, setShowPagePicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [isReactProject, setIsReactProject] = useState(false);
  const [devServerRunning, setDevServerRunning] = useState(false);

  // Determine base URL: React projects use the dev server proxy, legacy uses /website
  const baseUrl = isReactProject && devServerRunning
    ? `/api/companies/${companyId}/preview/`
    : `/api/companies/${companyId}/website`;
  const [iframeSrc, setIframeSrc] = useState(`${baseUrl}?t=${Date.now()}`);

  // Check if this is a React project and auto-start dev server
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      try {
        // Check for project files
        const res = await fetch(`/api/companies/${companyId}/project-files`, { headers: authHeaders() });
        const data = await res.json();
        const hasProjectFiles = data.files && data.files.length > 3;
        if (cancelled) return;
        setIsReactProject(hasProjectFiles);

        if (hasProjectFiles) {
          // Check dev server status via build-status (status === 'completed' means running)
          const statusRes = await fetch(`/api/companies/${companyId}/build-status`, { headers: authHeaders() });
          const statusData = await statusRes.json();
          if (cancelled) return;

          if (statusData.status === 'completed') {
            setDevServerRunning(true);
            setIframeSrc(`/api/companies/${companyId}/preview/?t=${Date.now()}`);
          } else {
            // Auto-start dev server (re-materializes from DB if needed)
            const startRes = await fetch(`/api/companies/${companyId}/preview/start`, { method: 'POST', headers: authHeaders() });
            const startData = await startRes.json();
            if (cancelled) return;
            if (startData.ok) {
              setDevServerRunning(true);
              // Wait a moment for Vite to be ready
              setTimeout(() => {
                if (!cancelled) setIframeSrc(`/api/companies/${companyId}/preview/?t=${Date.now()}`);
              }, 3000);
            }
          }
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [companyId, build.websiteReady]);

  // ── Preview EN DIRECT pendant le build ──────────────────────────────────────
  // Le backend démarre le serveur Vite dès que l'ossature est prête (bien avant
  // la fin du build). On sonde build-status pendant la construction: dès qu'un
  // serveur tourne (status 'completed' = getRunningApp existe), on bascule
  // l'iframe sur le proxy /preview/ → l'utilisateur voit le site se construire
  // page par page (le HMR de Vite met à jour le contenu tout seul). On ne fait
  // que LIRE le statut ici (jamais /preview/start) pour ne pas doubler le serveur
  // que le build vient de lancer.
  const buildingThis = (build.isBuilding || build.isBuildingWebsite) && build.companyId === companyId;
  useEffect(() => {
    if (!companyId || !buildingThis || devServerRunning) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const statusRes = await fetch(`/api/companies/${companyId}/build-status`, { headers: authHeaders() });
        const statusData = await statusRes.json();
        if (cancelled) return;
        if (statusData.status === 'completed' || statusData.previewUrl) {
          setIsReactProject(true);
          setDevServerRunning(true);
          setLoaded(false);
          setIframeSrc(`/api/companies/${companyId}/preview/?t=${Date.now()}`);
        }
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [companyId, buildingThis, devServerRunning]);

  // Fetch pages list
  useEffect(() => {
    if (!companyId) return;
    const fetchPages = async () => {
      try {
        const res = await api.companies.pages(companyId);
        const allPages = (res.pages || []).filter((p: any) => p.htmlContent);
        // Deduplicate by slug
        const seen = new Set<string>();
        const deduped = allPages.filter((p: any) => {
          if (seen.has(p.slug)) return false;
          seen.add(p.slug);
          return true;
        });
        setPages(deduped.map((p: any) => ({ slug: p.slug, title: p.title })));
      } catch {}
    };
    fetchPages();
  }, [companyId, build.websiteReady]);

  // Listen for slug changes from iframe SPA router
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'velbaz-page-change' && typeof e.data.slug === 'string') {
        setCurrentSlug(e.data.slug);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Close picker when clicking outside
  useEffect(() => {
    if (!showPagePicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPagePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPagePicker]);

  // Helper: get the correct iframe URL based on project type
  const getPreviewUrl = useCallback((slug?: string) => {
    const t = Date.now();
    if (isReactProject && devServerRunning) {
      const path = !slug || slug === 'index' ? '/' : `/${slug}`;
      return `/api/companies/${companyId}/preview${path}?t=${t}`;
    }
    if (slug && slug !== 'index') {
      return `/api/companies/${companyId}/website/${slug}?t=${t}`;
    }
    return `/api/companies/${companyId}/website?t=${t}`;
  }, [companyId, isReactProject, devServerRunning]);

  // Reset when companyId changes
  useEffect(() => {
    prevWebsiteReady.current = false;
    refreshCountRef.current = 0;
    previewRetryRef.current = 0;
    setLoaded(false);
    setCurrentSlug('index');
    setIsReactProject(false);
    setDevServerRunning(false);
    setIframeSrc(getPreviewUrl());
  }, [companyId]);

  // Auto-refresh iframe when websiteReady transitions to true
  useEffect(() => {
    if (build.websiteReady && !prevWebsiteReady.current && build.companyId === companyId) {
      const timer = setTimeout(() => {
        setLoaded(false);
        setIframeSrc(getPreviewUrl());
      }, 800);
      prevWebsiteReady.current = true;
      return () => clearTimeout(timer);
    }
    if (!build.websiteReady) {
      prevWebsiteReady.current = false;
    }
  }, [build.websiteReady, build.companyId, companyId, getPreviewUrl]);

  // ── Rafraîchissement de l'APERÇU pendant que l'IA modifie le site ─────────
  // Demande de l'utilisateur : le SITE GÉNÉRÉ doit se remettre à jour tout seul
  // à chaque modification. C'est UNIQUEMENT l'iframe d'aperçu qui se recharge —
  // l'application Velbaz, elle, ne se recharge JAMAIS toute seule (aucun
  // location.reload(), le chat, le prompt et le scroll restent intacts).
  useEffect(() => {
    if (!buildingThis) return;
    const interval = setInterval(() => {
      setIframeSrc(getPreviewUrl(currentSlug));
    }, 6000);
    return () => clearInterval(interval);
  }, [buildingThis, getPreviewUrl, currentSlug]);

  // Auto-refresh when refreshKey changes (site-edit trigger)
  const prevRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey !== prevRefreshKey.current) {
      prevRefreshKey.current = refreshKey;
      setTimeout(() => {
        setLoaded(false);
        setIframeSrc(getPreviewUrl(currentSlug));
        // Re-fetch pages list
        (async () => {
          try {
            const res = await api.companies.pages(companyId);
            const allPages = (res.pages || []).filter((p: any) => p.htmlContent);
            const seen = new Set<string>();
            const deduped = allPages.filter((p: any) => { if (seen.has(p.slug)) return false; seen.add(p.slug); return true; });
            setPages(deduped.map((p: any) => ({ slug: p.slug, title: p.title })));
          } catch {}
        })();
      }, 300);
    }
  }, [refreshKey, companyId, currentSlug]);

  // Notify parent of slug changes
  useEffect(() => {
    onSlugChange?.(currentSlug);
  }, [currentSlug, onSlugChange]);

  // Après chargement de l'iframe, vérifie que ce n'est pas une page d'erreur
  // du proxy (serveur en train de se relancer / dev server pas encore prêt).
  // Si c'est le cas, on réessaie avec le spinner de chargement toujours visible
  // au lieu d'afficher l'erreur figée à l'utilisateur.
  const handleIframeLoad = useCallback(() => {
    let mountAttempts = 0;
    const check = () => {
      let isError = false;
      let hasContent = false;
      try {
        const doc = iframeRef.current?.contentDocument;
        const text = (doc?.body?.innerText || '').trim();
        if (/Preview proxy error|Preview not running|no_files|Redémarrage de l'aperçu|Redémarrage de l’aperçu/i.test(text)) isError = true;
        const root = doc?.getElementById('root') || doc?.body;
        hasContent = !!(root && (root.children.length > 0 || text.length > 0));
      } catch {}
      if (isError && previewRetryRef.current < 30) {
        previewRetryRef.current += 1;
        setTimeout(() => setIframeSrc(getPreviewUrl(currentSlug)), 1500);
        return;
      }
      // Laisse le temps à React de monter l'app avant de révéler l'aperçu
      // (sinon on voit une page blanche pendant l'hydratation).
      if (!hasContent && mountAttempts < 14) {
        mountAttempts += 1;
        setTimeout(check, 300);
        return;
      }
      previewRetryRef.current = 0;
      setLoaded(true);
    };
    check();
  }, [getPreviewUrl, currentSlug]);

  const handleRefresh = () => {
    setLoaded(false);
    if (isReactProject && devServerRunning) {
      setIframeSrc(`/api/companies/${companyId}/preview/?t=${Date.now()}`);
    } else {
      setIframeSrc(`/api/companies/${companyId}/website?t=${Date.now()}`);
    }
  };

  const navigateToPage = (slug: string) => {
    setShowPagePicker(false);
    setLoaded(false);
    setCurrentSlug(slug);
    if (isReactProject && devServerRunning) {
      const path = slug === 'index' ? '/' : `/${slug}`;
      setIframeSrc(`/api/companies/${companyId}/preview${path}?t=${Date.now()}`);
    } else {
      const target = slug === 'index'
        ? `/api/companies/${companyId}/website?t=${Date.now()}`
        : `/api/companies/${companyId}/website/${slug}?t=${Date.now()}`;
      setIframeSrc(target);
    }
  };

  // Display path: your-website.com or your-website.com/about
  const displayPath = currentSlug === 'index' ? 'your-website.com' : `your-website.com/${currentSlug}`;
  // Find current page title
  const currentPage = pages.find(p => p.slug === currentSlug);

  return (
    <div className="w-full h-full flex flex-col" style={{ background: 'var(--surface-0)' }}>
      {/* Browser chrome */}
      <div className="flex items-center gap-2 px-4 py-2.5 shrink-0" style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#ff5f57' }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#ffbd2e' }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#28c840' }} />
        </div>
        <div className="flex-1 mx-3 relative" ref={pickerRef}>
          <button
            onClick={() => pages.length > 1 && setShowPagePicker(!showPagePicker)}
            className="w-full h-7 rounded-md px-3 flex items-center justify-between text-[11px] font-mono transition-colors"
            style={{
              background: 'var(--surface-4)',
              color: 'var(--text-secondary)',
              border: 'none',
              cursor: pages.length > 1 ? 'pointer' : 'default',
              outline: 'none',
            }}
          >
            <span className="truncate">{displayPath}</span>
            {pages.length > 1 && (
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none" className="shrink-0 ml-2" style={{ transform: showPagePicker ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>
                <path d="M1 1L5 5L9 1" stroke="var(--text-ghost)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>

          {/* Page picker dropdown */}
          {showPagePicker && pages.length > 1 && (
            <div
              className="absolute left-0 right-0 mt-1 rounded-lg overflow-hidden shadow-lg"
              style={{
                background: 'var(--surface-3)',
                border: '1px solid var(--border-default)',
                zIndex: 100,
                maxHeight: 240,
                overflowY: 'auto',
              }}
            >
              {pages.map((p) => (
                <button
                  key={p.slug}
                  onClick={() => navigateToPage(p.slug)}
                  className="w-full text-left px-3 py-2 flex items-center gap-2 transition-colors"
                  style={{
                    background: p.slug === currentSlug ? 'var(--surface-5)' : 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-5)')}
                  onMouseLeave={e => (e.currentTarget.style.background = p.slug === currentSlug ? 'var(--surface-5)' : 'transparent')}
                >
                  {p.slug === currentSlug && (
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--purple)' }} />
                  )}
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{p.title}</span>
                    <span className="text-[10px] font-mono truncate" style={{ color: 'var(--text-ghost)' }}>/{p.slug === 'index' ? '' : p.slug}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={handleRefresh} title="Refresh preview"
          className="text-[10px] px-2 py-1 rounded-md transition-colors hover:opacity-80"
          style={{ color: 'var(--text-dim)', background: 'var(--surface-4)', border: 'none', cursor: 'pointer' }}>
          ↻
        </button>
        <a
          href={getPreviewUrl(currentSlug)}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in a new tab"
          className="text-[10px] px-2 py-1 rounded-md transition-colors hover:opacity-80 no-underline"
          style={{ color: 'var(--text-dim)', background: 'var(--surface-4)', border: 'none', cursor: 'pointer', textDecoration: 'none' }}>
          Open ↗
        </a>
        <CollaboratorsButton companyId={companyId} />
      </div>

      {/* iframe */}
      <div className="flex-1 relative" style={{ background: '#000' }}>
        {!loaded && (
          <div className="absolute inset-0" style={{ background: '#000' }}>
            <div className="preview-loading-glow" />
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          className="w-full h-full"
          style={{ border: 'none', opacity: loaded ? 1 : 0, transition: 'opacity 0.5s ease' }}
          title="Website preview"
          onLoad={handleIframeLoad}
        />
      </div>
    </div>
  );
}


// ── File Attachment Component ──
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentFileIcon({ type }: { type: 'image' | 'code' | 'data' | 'text' }) {
  const cls = "w-4 h-4";
  const style = { color: 'var(--text-ghost)' };
  if (type === 'image') return (
    <svg className={cls} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" /><path d="M3 16l5-5 4 4 3-3 4 4" />
    </svg>
  );
  if (type === 'code') return (
    <svg className={cls} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1-2-2v-14a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /><path d="M10 13l-1 2 1 2" /><path d="M14 13l1 2-1 2" />
    </svg>
  );
  if (type === 'data') return (
    <svg className={cls} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1-2-2v-14a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /><path d="M8 11h1" /><path d="M8 15h1" /><path d="M11 11h5" /><path d="M11 15h5" />
    </svg>
  );
  return (
    <svg className={cls} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1-2-2v-14a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /><path d="M9 9h1" /><path d="M9 13h6" /><path d="M9 17h6" />
    </svg>
  );
}

function AttachmentChip({ name, size, isImage, previewUrl, iconType, onRemove }: {
  name: string;
  size?: number;
  isImage?: boolean;
  previewUrl?: string;
  iconType: 'image' | 'code' | 'data' | 'text';
  onRemove?: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative rounded-md"
      style={{ background: 'var(--surface-3)', maxWidth: 200 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center gap-2 pl-1 pr-2 py-1 min-w-[120px]">
        {isImage && previewUrl ? (
          <div className="w-8 h-8 overflow-hidden shrink-0 rounded" style={{ border: '1px solid var(--border-subtle)' }}>
            <img src={previewUrl} alt={name} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="w-8 h-8 flex items-center justify-center shrink-0 rounded" style={{ background: 'var(--surface-2)' }}>
            <AttachmentFileIcon type={iconType} />
          </div>
        )}
        <div className="flex flex-col min-w-0">
          <span className="text-[12px] font-medium truncate" style={{ color: 'var(--text-secondary)' }} title={name}>
            {name}
          </span>
          {size !== undefined && (
            <span className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>
              {formatFileSize(size)}
            </span>
          )}
        </div>
      </div>
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center z-10 transition-opacity duration-150"
          style={{
            background: 'var(--surface-0)',
            border: '1px solid var(--border)',
            color: 'var(--text-ghost)',
            opacity: hovered ? 1 : 0,
          }}
          type="button"
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M18 6L6 18" /><path d="M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ── ToolGroup-style icons ──
function TGChevronIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 6l6 6l-6 6" />
    </svg>
  );
}
function TGFileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
    </svg>
  );
}
function TGSearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="10" cy="10" r="7" /><path d="M21 21l-6 -6" />
    </svg>
  );
}
function TGTerminalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 7l5 5l-5 5" /><path d="M12 19h7" />
    </svg>
  );
}
function TGPaletteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2a10 10 0 0 1 0 20c-1.1 0-2-.9-2-2v-1a2 2 0 0 0-2-2h-1c-1.1 0-2-.9-2-2a10 10 0 0 1 7-9.6" />
      <circle cx="8" cy="10" r="1" fill="currentColor" /><circle cx="12" cy="7" r="1" fill="currentColor" /><circle cx="16" cy="10" r="1" fill="currentColor" />
    </svg>
  );
}
function TGCheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

type BuildStepCategory = 'file' | 'search' | 'command' | 'design' | 'generic';

function categorizeBuildStep(content: string): BuildStepCategory {
  const c = content.toLowerCase();
  if (c.includes('building page') || c.includes('creating page') || c.includes('page created') || c.includes('writing') || c.includes('saving') || c.includes('file')) return 'file';
  if (c.includes('analyzing') || c.includes('researching') || c.includes('searching') || c.includes('looking') || c.includes('finding')) return 'search';
  if (c.includes('running') || c.includes('testing') || c.includes('qa') || c.includes('deploying') || c.includes('installing') || c.includes('compiling') || c.includes('building project') || c.includes('optimizing')) return 'command';
  if (c.includes('logo') || c.includes('design') || c.includes('style') || c.includes('color') || c.includes('brand') || c.includes('image') || c.includes('generating')) return 'design';
  return 'generic';
}

const CATEGORY_ICON_MAP: Record<BuildStepCategory, React.FC<{ className?: string }>> = {
  file: TGFileIcon,
  search: TGSearchIcon,
  command: TGTerminalIcon,
  design: TGPaletteIcon,
  generic: TGFileIcon,
};

function cleanStepText(text: string): string {
  // Keep [IMG:url] tags — they'll be rendered as hover previews
  return text
    .replace(/\[CODE_START:[^\]]*\]\s*/g, '')
    .replace(/\[CODE_STREAM:[^\]]*\][\s\S]*/g, '')
    .replace(/\[CODE_DONE:[^\]]*\][\s\S]*/g, '')
    .replace(/\[CODE_EDIT:[^\]]*\][\s\S]*/g, '')
    .replace(/\[REASONING:[^:\]]+:(intent|outcome)\][\s\S]*/g, '')
    .replace(/✅|✓|✗|🔄/g, '')
    .trim();
}

// Nettoie les messages d'HISTORIQUE sauvegardés avec des marqueurs internes
// ([CODE_START/EDIT/DONE/STREAM:...], [REASONING:...]) et leur code brut.
// Les payloads de code s'étalent sur plusieurs lignes : on saute tout jusqu'à
// la prochaine ligne de progression lisible (préfixée d'un emoji de statut).
// Le serveur conserve le bloc [QUESTIONS]...[/QUESTIONS] dans le message
// enregistré : si le flux SSE a été coupé (navigation depuis l'accueil vers
// /chat/<id>, mobile, rechargement de page), la réponse est récupérée depuis
// l'historique — sans ce parsing, le formulaire de questions n'apparaissait
// jamais alors que l'IA disait « j'ai quelques questions ».
function parseQuestionsFromContent(raw: string): any[] | null {
  try {
    const m = (raw || '').match(/\[QUESTIONS\]([\s\S]*?)\[\/QUESTIONS\]/);
    if (!m) return null;
    const body = m[1];
    const fb = body.indexOf('['); const lb = body.lastIndexOf(']');
    const parsed = JSON.parse(fb !== -1 && lb > fb ? body.slice(fb, lb + 1) : body.trim());
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter((q: any) => q && typeof q.q === 'string' && q.q.length > 2);
    return valid.length > 0 ? valid : null;
  } catch { return null; }
}

function sanitizeHistoryContent(raw: string): string {
  if (!/\[(CODE_(START|STREAM|DONE|EDIT)|REASONING):/.test(raw)) return raw;
  const TAG_RE = /^\[(CODE_(START|STREAM|DONE|EDIT)|REASONING):/;
  const PROGRESS_RE = /^(?:🧠|📝|📄|💾|🚀|✏️|🔎|🎨|📋|↩️|ℹ️|♻️|🔧|✍️|⚠️|✅|✓|▶|✗)/u;
  const out: string[] = [];
  let skipping = false;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (TAG_RE.test(t)) { skipping = true; continue; }
    if (skipping) {
      if (!PROGRESS_RE.test(t)) continue;
      skipping = false;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Highlight ("fluo marker") palette for AI-flagged important text ──
// Syntax in assistant text: ==text== (auto color, stable per phrase) or
// ==color|text== (explicit named color). Rendered as a rounded rect with a
// vivid background that grows left→right over the phrase (see .mib-hl in styles.css).
const HL_PALETTE: Record<string, { bg: string; fg: string }> = {
  yellow: { bg: '#FFE600', fg: '#1A1500' },
  green:  { bg: '#39FF14', fg: '#052100' },
  lime:   { bg: '#C6FF00', fg: '#1C2400' },
  cyan:   { bg: '#00E5FF', fg: '#00252B' },
  orange: { bg: '#FF8A00', fg: '#2A1400' },
  pink:   { bg: '#FF2D95', fg: '#FFFFFF' },
  purple: { bg: '#B026FF', fg: '#FFFFFF' },
  blue:   { bg: '#2D7DFF', fg: '#FFFFFF' },
  red:    { bg: '#FF3B3B', fg: '#FFFFFF' },
};
const HL_KEYS = Object.keys(HL_PALETTE);
function hlHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function hlColorFor(txt: string, named?: string): { bg: string; fg: string } {
  if (named && HL_PALETTE[named]) return HL_PALETTE[named];
  return HL_PALETTE[HL_KEYS[hlHash(txt) % HL_KEYS.length]];
}
/** Render a ==highlight== token as a layered rounded-rect marker that grows left→right. */
function renderHighlight(raw: string, key: string): React.ReactNode {
  const inner = raw.slice(2, -2);
  let named: string | undefined;
  let txt = inner;
  const pipe = inner.indexOf('|');
  if (pipe > 0) {
    const c = inner.slice(0, pipe).trim().toLowerCase();
    if (HL_PALETTE[c]) { named = c; txt = inner.slice(pipe + 1); }
  }
  txt = txt.trim();
  const pal = hlColorFor(txt, named);
  const style = { ['--hl-bg' as any]: pal.bg, ['--hl-fg' as any]: pal.fg } as React.CSSProperties;
  return (
    <span className="mib-hl" style={style} key={key}>
      <span className="mib-hl-base">{txt}</span>
      <span className="mib-hl-rect" aria-hidden="true" />
      <span className="mib-hl-top" aria-hidden="true">{txt}</span>
    </span>
  );
}

/** Render build step text with LinkPreview, ColorPreview, and ImagePreview for rich inline content */
function renderStepText(text: string): React.ReactNode {
  // Combined regex: markdown links, [IMG:url] tags, hex colors, bare URLs
  const TOKEN_RE = /(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|(\[IMG:(https?:\/\/[^\]]+)\])|(#[0-9a-fA-F]{6}\b)|(https?:\/\/[^\s),;!?\]]+)/g;
  if (!TOKEN_RE.test(text)) return text;
  TOKEN_RE.lastIndex = 0;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let ki = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(<React.Fragment key={`st-${ki++}`}>{text.slice(lastIndex, m.index)}</React.Fragment>);
    if (m[1]) {
      // Markdown link: [label](url)
      const label = m[2];
      const url = m[3];
      parts.push(
        <LinkPreview key={`slp-${ki++}`} url={url}>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer', borderBottom: '1px dashed var(--text-ghost)', paddingBottom: 1 }}>{label}</span>
        </LinkPreview>
      );
    } else if (m[4]) {
      // [IMG:url] tag — render as hoverable image preview.
      // The descriptive text (e.g. "Logo created and saved") is already rendered
      // inline as the preceding fragment, so use a neutral label here to avoid
      // duplicating that text next to the thumbnail.
      const imgUrl = m[5];
      const hasTextBefore = /\S/.test(text.slice(Math.max(0, m.index - 60), m.index));
      const label = hasTextBefore ? 'preview' : 'Image';
      parts.push(
        <ImagePreview key={`sip-${ki++}`} src={imgUrl} alt={label}>
          {label}
        </ImagePreview>
      );
    } else if (m[6]) {
      // Hex color code — render with ColorPreview swatch
      const hex = m[6];
      parts.push(
        <ColorPreview key={`scp-${ki++}`} color={hex}>
          {hex.toUpperCase()}
        </ColorPreview>
      );
    } else if (m[7]) {
      // Bare URL
      const url = m[7];
      let domain = '';
      try { domain = new URL(url).hostname.replace('www.', ''); } catch { domain = url; }
      parts.push(
        <LinkPreview key={`slp-${ki++}`} url={url}>
          <span style={{ color: 'var(--teal)', textDecoration: 'underline', textUnderlineOffset: 2, cursor: 'pointer' }}>{domain}</span>
        </LinkPreview>
      );
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) parts.push(<React.Fragment key={`st-${ki++}`}>{text.slice(lastIndex)}</React.Fragment>);
  return <>{parts}</>;
}

// ── Parse [CODE_START/DONE] tags from step content ──
// Must match DIFF_SEP in packages/web/src/api/builder/engine.ts
const DIFF_SEP = '⟦⟦VELBAZ_DIFF_SEP⟧⟧';

type CodeBlock = {
  state: 'pending' | 'completed';
  variant: 'write' | 'edit';
  filePath: string;
  totalLines?: number;
  totalChars?: number;
  snippet?: string;      // new content (write) or the "after" side (edit)
  oldSnippet?: string;   // "before" side, only for edits → enables red/green diff
};

function parseCodeBlock(content: string): CodeBlock | null {
  // Modification of an existing file → red/green diff (OLD⟦SEP⟧NEW payload).
  const editMatch = content.match(/\[CODE_EDIT:([^:\]]+):(\d+):(\d+)\]([\s\S]*)/);
  if (editMatch) {
    const payload = editMatch[4] || '';
    const sepIdx = payload.indexOf(DIFF_SEP);
    const oldSnippet = sepIdx >= 0 ? payload.slice(0, sepIdx) : '';
    const newSnippet = sepIdx >= 0 ? payload.slice(sepIdx + DIFF_SEP.length) : payload;
    return {
      state: 'completed',
      variant: 'edit',
      filePath: editMatch[1],
      totalLines: parseInt(editMatch[2], 10),
      totalChars: parseInt(editMatch[3], 10),
      snippet: newSnippet || undefined,
      oldSnippet,
    };
  }
  // New file creation (completed) → all-green scrolling write.
  const doneMatch = content.match(/\[CODE_DONE:([^:\]]+):(\d+):(\d+)\]([\s\S]*)/);
  if (doneMatch) {
    return {
      state: 'completed',
      variant: 'write',
      filePath: doneMatch[1],
      totalLines: parseInt(doneMatch[2], 10),
      totalChars: parseInt(doneMatch[3], 10),
      snippet: doneMatch[4] || undefined,
    };
  }
  // Live streaming write → pending, but WITH the partial code so the rectangle
  // fills in real time. Payload format matches CODE_DONE: [CODE_STREAM:path:lines:chars]<code>
  const streamMatch = content.match(/\[CODE_STREAM:([^:\]]+):(\d+):(\d+)\]([\s\S]*)/);
  if (streamMatch) {
    return {
      state: 'pending',
      variant: 'write',
      filePath: streamMatch[1],
      totalLines: parseInt(streamMatch[2], 10),
      totalChars: parseInt(streamMatch[3], 10),
      snippet: streamMatch[4] || undefined,
    };
  }
  // Check for CODE_START (pending, no content yet)
  const startMatch = content.match(/\[CODE_START:([^\]]+)\]/);
  if (startMatch) {
    return {
      state: 'pending',
      variant: 'write',
      filePath: startMatch[1],
    };
  }
  return null;
}

// ── Parse [REASONING:key:intent|outcome]text — emitted by the dedicated
// reasoning agent (packages/web/src/api/builder/reasoning-agent.ts) to explain,
// in plain language, what it's about to do (intent) and what it just did
// (outcome) for a given task. Rendered as a small expandable note UNDER the
// matching step/task row in the chat.
type ReasoningNote = { key: string; kind: 'intent' | 'outcome'; text: string };

function parseReasoning(content: string): ReasoningNote | null {
  const m = content.match(/\[REASONING:([^:\]]+):(intent|outcome)\]([\s\S]*)/);
  if (!m) return null;
  return { key: m[1], kind: m[2] as 'intent' | 'outcome', text: m[3] || '' };
}

// Derives the same stable task key the reasoning agent uses server-side
// (see packages/web/src/api/builder/reasoning-agent.ts) from a REGULAR step's
// content, so its [REASONING:...] notes (emitted as separate activity rows)
// can be matched back to the step they explain.
function deriveTaskKeyFromContent(content: string): string | null {
  const codeMatch = content.match(/\[CODE_(?:START|STREAM|DONE|EDIT):([^:\]]+)/);
  if (codeMatch) {
    const path = codeMatch[1];
    const fileMatch = path.match(/src\/pages\/(.+)$/);
    if (fileMatch) return `page:${fileMatch[1]}`;
  }
  if (/planification|📋 plan/i.test(content)) return 'plan';
  if (/système de design|✅ design:/i.test(content)) return 'design';
  return null;
}

// Collapsible "agent reasoning" block: shows the intent note first (grayed,
// "Pourquoi") then the outcome note (once available, "Résultat"). Sits right
// under the task/step row it explains.
function ReasoningBlock({ notes }: { notes: ReasoningNote[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!notes.length) return null;
  const intent = notes.find(n => n.kind === 'intent');
  const outcome = notes.find(n => n.kind === 'outcome');

  return (
    <div className="pl-5 mt-0.5 mb-1">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 text-[11px] cursor-pointer"
        style={{ color: 'var(--text-ghost)' }}
      >
        <svg
          className="w-3 h-3 shrink-0 transition-transform"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        Raisonnement de l'agent
      </button>
      {expanded && (
        <div className="pl-4 mt-1 space-y-1.5 border-l" style={{ borderColor: 'var(--border-subtle)' }}>
          {intent && (
            <p className="text-[12px] leading-relaxed pl-2" style={{ color: 'var(--text-dim)' }}>
              <span className="font-medium" style={{ color: 'var(--text-muted)' }}>Je vais faire : </span>
              {intent.text}
            </p>
          )}
          {outcome && (
            <p className="text-[12px] leading-relaxed pl-2" style={{ color: 'var(--text-dim)' }}>
              <span className="font-medium" style={{ color: 'var(--text-muted)' }}>J'ai fait : </span>
              {outcome.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function summarizeBuildSteps(steps: Message[]): string {
  let files = 0, searches = 0, commands = 0, designs = 0;
  for (const s of steps) {
    const cat = categorizeBuildStep(s.content);
    if (cat === 'file') files++;
    else if (cat === 'search') searches++;
    else if (cat === 'command') commands++;
    else if (cat === 'design') designs++;
  }
  const parts: string[] = [];
  if (files > 0) parts.push(`${files} file${files > 1 ? 's' : ''}`);
  if (searches > 0) parts.push(`${searches} ${searches > 1 ? 'searches' : 'search'}`);
  if (commands > 0) parts.push(`${commands} command${commands > 1 ? 's' : ''}`);
  if (designs > 0) parts.push(`${designs} design${designs > 1 ? 's' : ''}`);
  if (parts.length === 0) return `${steps.length} step${steps.length > 1 ? 's' : ''}`;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

// ── Task Group system: each task type is its own separate ToolGroup ──
type TaskGroupType = 'research' | 'analysis' | 'brand' | 'marketing' | 'content' | 'development' | 'design' | 'testing' | 'deployment' | 'other';

const TASK_GROUP_CONFIG: Record<TaskGroupType, { label: string; shimmerLabel: string; Icon: React.FC<{ className?: string }> }> = {
  research: { label: 'Research complete', shimmerLabel: 'Researching...', Icon: TGSearchIcon },
  analysis: { label: 'Analysis complete', shimmerLabel: 'Analyzing...', Icon: TGSearchIcon },
  brand: { label: 'Branding complete', shimmerLabel: 'Working on brand...', Icon: TGPaletteIcon },
  marketing: { label: 'Marketing complete', shimmerLabel: 'Preparing marketing...', Icon: TGFileIcon },
  content: { label: 'Content ready', shimmerLabel: 'Creating content...', Icon: TGFileIcon },
  development: { label: 'Development complete', shimmerLabel: 'Building pages...', Icon: TGTerminalIcon },
  design: { label: 'Design complete', shimmerLabel: 'Designing...', Icon: TGPaletteIcon },
  testing: { label: 'Testing complete', shimmerLabel: 'Running tests...', Icon: TGTerminalIcon },
  deployment: { label: 'Deployment complete', shimmerLabel: 'Deploying...', Icon: TGTerminalIcon },
  other: { label: 'Task complete', shimmerLabel: 'Working...', Icon: TGFileIcon },
};

function getTaskGroup(content: string): TaskGroupType {
  // Code emit tags are always development
  if (content.includes('[CODE_START:') || content.includes('[CODE_STREAM:') || content.includes('[CODE_DONE:') || content.includes('[CODE_EDIT:')) return 'development';
  // Reasoning notes follow the group of the task they explain (page → development,
  // plan → analysis, design → design), so they render next to the matching step.
  const reasoningMatch = content.match(/\[REASONING:([^:\]]+):(?:intent|outcome)\]/);
  if (reasoningMatch) {
    const key = reasoningMatch[1];
    if (key.startsWith('page:')) return 'development';
    if (key === 'plan') return 'analysis';
    if (key === 'design') return 'design';
  }
  const c = content.toLowerCase();
  // Research
  if (c.includes('research') || c.includes('finding information') || c.includes('looking up') || c.includes('competitor') || c.includes('market research')) return 'research';
  // Analysis
  if (c.includes('analyz') || c.includes('analysis') || c.includes('evaluating') || c.includes('assessing') || c.includes('reviewing')) return 'analysis';
  // Brand
  if (c.includes('brand') || c.includes('logo') || c.includes('identity') || c.includes('color palette') || c.includes('typography') || c.includes('favicon')) return 'brand';
  // Marketing
  if (c.includes('marketing') || c.includes('seo') || c.includes('meta') || c.includes('social media') || c.includes('campaign') || c.includes('ads') || c.includes('audience') || c.includes('strategy')) return 'marketing';
  // Content
  if (c.includes('content') || c.includes('copywriting') || c.includes('writing text') || c.includes('headline') || c.includes('tagline') || c.includes('about') || c.includes('description')) return 'content';
  // Design
  if (c.includes('design') || c.includes('style') || c.includes('layout') || c.includes('ui') || c.includes('ux') || c.includes('visual') || c.includes('color') || c.includes('image') || c.includes('generating') || c.includes('illustration')) return 'design';
  // Development
  if (c.includes('building page') || c.includes('creating page') || c.includes('page created') || c.includes('coding') || c.includes('html') || c.includes('css') || c.includes('component') || c.includes('section') || c.includes('saving') || c.includes('file') || c.includes('writing') || c.includes('building project')) return 'development';
  // Testing
  if (c.includes('testing') || c.includes('qa') || c.includes('checking') || c.includes('validating') || c.includes('optimizing') || c.includes('performance')) return 'testing';
  // Deployment
  if (c.includes('deploy') || c.includes('publish') || c.includes('launching') || c.includes('going live') || c.includes('hosting')) return 'deployment';
  return 'other';
}

type TaskGroup = {
  type: TaskGroupType;
  steps: Message[];
  isComplete: boolean; // all steps done (have ✅/✓)
  isActive: boolean;   // contains the currently running step (last overall)
};

function groupBuildStepsByTask(steps: Message[], lastStepId?: string): TaskGroup[] {
  const groupMap = new Map<TaskGroupType, Message[]>();
  const groupOrder: TaskGroupType[] = [];

  for (const step of steps) {
    const type = getTaskGroup(step.content);
    if (!groupMap.has(type)) {
      groupMap.set(type, []);
      groupOrder.push(type);
    }
    groupMap.get(type)!.push(step);
  }

  // First pass: determine which group is active
  const activeType = lastStepId
    ? groupOrder.find(type => groupMap.get(type)!.some(s => s.id === lastStepId)) ?? null
    : null;

  return groupOrder.map(type => {
    const groupSteps = groupMap.get(type)!;
    const isActive = activeType === type;
    // Reasoning notes never carry a checkmark — exclude them from the
    // completeness heuristic so they don't make a finished group look pending.
    const realGroupSteps = groupSteps.filter(s => !parseReasoning(s.content));
    const hasCheckmarks = realGroupSteps.length > 0 && realGroupSteps.every(s => {
      const c = s.content?.toLowerCase() || '';
      return c.includes('✅') || c.includes('✓');
    });
    // A group is complete if it has checkmarks OR if there's an active group and this one comes before it (past phase)
    const isPastPhase = activeType !== null && !isActive && groupOrder.indexOf(type) < groupOrder.indexOf(activeType);
    const isComplete = hasCheckmarks || isPastPhase;
    return { type, steps: groupSteps, isComplete, isActive };
  });
}

// ── Single Task Group Row component ──
// On affiche TOUT le déroulé : chaque groupe liste toutes ses étapes, pendant
// le travail comme après. L'étape en cours est en shimmer et arrive avec une
// petite animation d'entrée. Le chevron permet de replier un groupe à la main.
function TaskGroupRow({ group, defaultExpanded }: { group: TaskGroup; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? true);
  const config = TASK_GROUP_CONFIG[group.type];
  const HeaderIcon = config.Icon;

  // Separate the dedicated reasoning-agent notes ([REASONING:key:intent|outcome])
  // from the real work steps — they're rendered as a small collapsible block
  // right under the step they explain, keyed by task key, not as their own row.
  const reasoningByKey = useMemo(() => {
    const map = new Map<string, ReasoningNote[]>();
    for (const s of group.steps) {
      const note = parseReasoning(s.content);
      if (!note) continue;
      const list = map.get(note.key) || [];
      list.push(note);
      map.set(note.key, list);
    }
    return map;
  }, [group.steps]);
  const realSteps = useMemo(() => group.steps.filter(s => !parseReasoning(s.content)), [group.steps]);

  const isPending = group.isActive && !group.isComplete;
  const stepCount = realSteps.length;

  // Track the exiting step for animation
  const prevStepRef = useRef<{ id: string; content: string } | null>(null);
  const [exitingStep, setExitingStep] = useState<{ id: string; content: string } | null>(null);

  const currentStep = isPending ? realSteps[realSteps.length - 1] : null;

  // When a new step arrives during active build, trigger exit animation on the old one
  useEffect(() => {
    if (!isPending || !currentStep) return;
    const prev = prevStepRef.current;
    if (prev && prev.id !== currentStep.id) {
      // Previous step is done — animate it out
      setExitingStep({ id: prev.id, content: prev.content });
      // Clear the exiting step after animation completes
      const timer = setTimeout(() => setExitingStep(null), 400);
      prevStepRef.current = { id: currentStep.id, content: currentStep.content };
      return () => clearTimeout(timer);
    }
    prevStepRef.current = { id: currentStep.id, content: currentStep.content };
  }, [currentStep?.id, isPending]);

  // Render a single step row (+ the agent's reasoning notes for that step, if any)
  const renderStepRow = (s: { id: string; content: string }, animClass: string, isShimmer: boolean) => {
    const codeBlock = parseCodeBlock(s.content);
    const cat = categorizeBuildStep(s.content);
    const Icon = CATEGORY_ICON_MAP[cat];
    const taskKey = deriveTaskKeyFromContent(s.content);
    const notes = taskKey ? reasoningByKey.get(taskKey) : undefined;
    return (
      <div key={s.id} className={animClass}>
        <div className="flex items-center gap-2 h-7 text-sm" style={{ color: 'var(--text-dim)' }}>
          <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-ghost)' }} />
          <span className={`truncate ${isShimmer && !codeBlock ? 'an-tg-shimmer' : ''}`}>{renderStepText(cleanStepText(s.content))}</span>
        </div>
        {codeBlock && (
          <div className="mt-1 mb-2">
            <EditTool
              state={codeBlock.state}
              variant={codeBlock.variant}
              filePath={codeBlock.filePath}
              oldContent={codeBlock.oldSnippet}
              newContent={codeBlock.snippet}
              totalLines={codeBlock.totalLines}
              totalChars={codeBlock.totalChars}
            />
          </div>
        )}
        {notes && notes.length > 0 && <ReasoningBlock notes={notes} />}
      </div>
    );
  };

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="group w-full flex items-center gap-2 h-8 text-sm text-left cursor-pointer"
      >
        {stepCount > 1 && (
          <TGChevronIcon
            className="w-3.5 h-3.5 shrink-0 transition-transform"
            style={{ color: 'var(--text-ghost)', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          />
        )}
        {!isPending && group.isComplete && (
          <TGCheckIcon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--green-accent, #22c55e)' }} />
        )}
        {isPending && (
          <HeaderIcon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-ghost)' }} />
        )}
        {!isPending && !group.isComplete && (
          <HeaderIcon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-ghost)' }} />
        )}
        <span className={`shrink-0 text-[13px] ${isPending ? 'an-tg-shimmer' : ''}`} style={isPending ? undefined : { color: 'var(--text-muted)' }}>
          {isPending ? config.shimmerLabel : config.label}
        </span>
        <span className="text-[13px] truncate min-w-0 flex-1" style={{ color: 'var(--text-ghost)' }}>
          {stepCount > 1 ? ` · ${stepCount} steps` : ''}
        </span>
      </button>

      {/* ── TRAVAIL EN COURS : tout le déroulé, l'étape en cours en dernier ──
          On ne masque plus les étapes passées du groupe actif : l'utilisateur
          veut revoir l'intégralité du flux, pas seulement la ligne courante. */}
      {isPending && expanded && currentStep && (
        <div className="pl-5 space-y-0.5">
          {realSteps.map((s) => renderStepRow(s, s.id === currentStep.id ? 'build-live-step-enter' : '', s.id === currentStep.id))}
        </div>
      )}
      {isPending && !expanded && currentStep && (
        <div className="pl-5 relative overflow-hidden" style={{ minHeight: '28px' }}>
          {exitingStep && renderStepRow(exitingStep, 'build-live-step-exit', false)}
          {renderStepRow(currentStep, 'build-live-step-enter', true)}
        </div>
      )}

      {/* ── COMPLETED BUILD (history): show all steps expandable ── */}
      {!isPending && expanded && stepCount > 1 && (
        <div className="pl-5 space-y-0.5">
          {realSteps.map((s) => {
            const codeBlock = parseCodeBlock(s.content);
            const cat = categorizeBuildStep(s.content);
            const Icon = CATEGORY_ICON_MAP[cat];
            const taskKey = deriveTaskKeyFromContent(s.content);
            const notes = taskKey ? reasoningByKey.get(taskKey) : undefined;
            return (
              <div key={s.id}>
                <div className="flex items-center gap-2 h-7 text-sm" style={{ color: 'var(--text-dim)' }}>
                  <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-ghost)' }} />
                  <span className="truncate">{renderStepText(cleanStepText(s.content))}</span>
                </div>
                {codeBlock && (
                  <div className="mt-1 mb-2">
                    <EditTool
                      state={codeBlock.state}
                      variant={codeBlock.variant}
                      filePath={codeBlock.filePath}
                      oldContent={codeBlock.oldSnippet}
                      newContent={codeBlock.snippet}
                      totalLines={codeBlock.totalLines}
                      totalChars={codeBlock.totalChars}
                    />
                  </div>
                )}
                {notes && notes.length > 0 && <ReasoningBlock notes={notes} />}
              </div>
            );
          })}
        </div>
      )}
      {!isPending && expanded && stepCount === 1 && (
        <div className="pl-5">
          {renderStepRow(realSteps[0], '', false)}
        </div>
      )}
    </div>
  );
}

// ── ToolGroup-style build history block (completed build) — each task separate ──
function BuildHistoryBlock({ steps, summary }: { steps: Message[]; summary: string }) {
  const taskGroups = useMemo(() => groupBuildStepsByTask(steps), [steps]);

  return (
    <div className="w-full my-2 space-y-0.5">
      {taskGroups.map((group, i) => (
        <TaskGroupRow key={`${group.type}-${i}`} group={{ ...group, isComplete: true, isActive: false }} defaultExpanded />
      ))}
    </div>
  );
}

// ── Thinking indicator ──────────────────────────────────────────────────────
// Shown while the AI is reasoning (before any text streams back). A single line
// of text colours itself dark→white→dark as a light band sweeps across, and a
// short list of "what I'm doing" tasks reveals itself one by one — so the wait
// feels alive and the user sees the AI is actually working through steps.
const THINKING_PHRASES = [
  "I'm thinking",
  "I'm analyzing your request",
  "I'm gathering context",
  "I'm preparing a response",
];
const THINKING_TASKS = [
  'Understanding the request',
  'Analyzing project context',
  'Searching for the best options',
  'Structuring the response',
];

// ── Preview live ──────────────────────────────────────────────────────────
// Rectangle noir sobre qui montre EN TEMPS RÉEL l'aperçu de ce que l'IA fait :
// vraies captures d'écran (screenshots Firecrawl) des pages qu'elle ouvre/
// scrape/code. L'image et la légende viennent d'événements serveur réels —
// tant qu'aucune image n'est arrivée, on affiche un état de chargement neutre.
type LiveCameraFeed = { kind: 'browse' | 'screenshot' | 'search' | 'code' | 'analyze'; imageUrl?: string; url?: string; caption?: string };
function LiveCamera({ feed }: { feed: LiveCameraFeed }) {
  const kindLabel: Record<LiveCameraFeed['kind'], string> = {
    browse: 'Browsing',
    screenshot: 'Screenshot',
    search: 'Search',
    code: 'Coding',
    analyze: 'Analysis',
  };
  const caption = feed.caption || (feed.url ? feed.url : BRAND + ' is working…');
  // Une image d'aperçu peut échouer (service de capture lent/indisponible) :
  // on retombe alors proprement sur l'état de chargement neutre.
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [feed.imageUrl]);
  const showImg = feed.imageUrl && !imgFailed;

  return (
    <div className="mt-2 mb-1 w-full max-w-xl">
      <div
        className="relative overflow-hidden rounded-lg"
        style={{
          aspectRatio: '16 / 9',
          background: '#000',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {/* Preview réel (screenshot de la page) ou état de chargement neutre */}
        {showImg ? (
          <img
            key={feed.imageUrl}
            src={feed.imageUrl}
            alt="Preview"
            onError={() => setImgFailed(true)}
            className="an-cam-fade absolute inset-0 w-full h-full object-cover object-top"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <span
              className="inline-block w-5 h-5 rounded-full border-2 animate-spin"
              style={{ borderColor: 'rgba(255,255,255,0.25)', borderTopColor: 'transparent' }}
            />
            <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Preview loading…
            </span>
          </div>
        )}

        {/* Légende sobre en bas */}
        <div
          className="absolute inset-x-0 bottom-0 px-3 py-2"
          style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.78))' }}
        >
          <div className="flex items-center gap-2">
            <span
              className="text-[9px] px-1.5 py-[1px] rounded uppercase tracking-wider flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)' }}
            >
              {kindLabel[feed.kind]}
            </span>
            <span className="text-[11px] leading-tight truncate" style={{ color: 'rgba(255,255,255,0.85)' }}>
              {caption}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThinkingIndicator({ label, steps }: { label?: string; steps?: { id: string; label: string }[] }) {
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [visibleTasks, setVisibleTasks] = useState(1);
  // When a specific label is given (ex: "I'm editing your app"), it means we
  // already know exactly what's happening — the generic 4-step placeholder
  // list ("Understanding the request", ...) would be misleading filler, so
  // we only show the headline in that case.
  const showTasks = !label;

  useEffect(() => {
    if (!showTasks) return;
    // Rotate the headline phrase.
    const p = setInterval(() => setPhraseIdx((i) => (i + 1) % THINKING_PHRASES.length), 2200);
    // Reveal task lines one after another, then hold on the last.
    const t = setInterval(
      () => setVisibleTasks((n) => (n < THINKING_TASKS.length ? n + 1 : n)),
      900,
    );
    return () => { clearInterval(p); clearInterval(t); };
  }, [showTasks]);

  const headline = label || THINKING_PHRASES[phraseIdx];

  // ── Étapes RÉELLES streamées par le serveur (event `progress`) ──
  // Priorité absolue : si l'IA nous dit ce qu'elle fait vraiment, on l'affiche
  // tel quel (fini la liste factice sur minuteur). La dernière étape tourne
  // (en cours), toutes les précédentes sont cochées (terminées).
  // IMPORTANT : ce bloc est placé APRÈS tous les hooks (useState/useEffect)
  // pour respecter les Rules of Hooks — un return anticipé avant les hooks
  // ferait crasher React (page grise) quand les steps apparaissent/disparaissent.
  if (steps && steps.length > 0) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <VelbazIcon state="thinking" size={22} />
          <span className="an-think-shimmer text-[13px] font-medium">{BRAND} is working…</span>
        </div>
        <div className="pl-7 space-y-1">
          {steps.map((task, i) => {
            const isCurrent = i === steps.length - 1;
            return (
              <div key={task.id} className="an-think-task flex items-center gap-2 text-[12px]">
                {isCurrent ? (
                  <svg className="w-3 h-3 shrink-0 animate-spin" viewBox="0 0 24 24" style={{ color: 'var(--text-dim)' }}>
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="var(--text-ghost)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                )}
                <span className={isCurrent ? 'an-think-shimmer' : ''} style={isCurrent ? undefined : { color: 'var(--text-ghost)' }}>{task.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (!showTasks) {
    return (
      <div className="flex items-center gap-2 mb-1.5">
        <VelbazIcon state="thinking" size={22} />
        <span key={headline} className="an-think-shimmer text-[13px] font-medium">{headline}</span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <VelbazIcon state="thinking" size={22} />
        <span key={headline} className="an-think-shimmer text-[13px] font-medium">{headline}</span>
      </div>
      <div className="pl-7 space-y-1">
        {THINKING_TASKS.slice(0, visibleTasks).map((task, i) => {
          const isCurrent = i === visibleTasks - 1;
          return (
            <div key={task} className="an-think-task flex items-center gap-2 text-[12px]">
              {isCurrent ? (
                <svg className="w-3 h-3 shrink-0 animate-spin" viewBox="0 0 24 24" style={{ color: 'var(--text-dim)' }}>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="var(--text-ghost)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              )}
              <span className={isCurrent ? 'an-think-shimmer' : ''} style={isCurrent ? undefined : { color: 'var(--text-ghost)' }}>{task}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Ajoute un projet à la sidebar avec un nom en "chargement", puis sonde en
// arrière-plan jusqu'à ce que le vrai nom (et le logo) généré par l'IA arrive,
// et met à jour l'entrée. Réutilisé à la pré-création (1er message) et au build.
function addProjectWithNamePoll(company: { id: string; name: string }, nameReady: boolean) {
  const nameStillLoading = !nameReady;
  useSidebar.getState().addProject({
    id: company.id,
    name: company.name,
    createdAt: new Date(),
    loading: nameStillLoading,
  });
  if (!nameStillLoading || !company.id) return;
  const provisionalName = company.name;
  const companyIdForPoll = company.id;
  (async () => {
    let nameDone = false;
    let logoDone = false;
    // Poll long (~10 min) : à la pré-création le nom reste volontairement en
    // "chargement" jusqu'à ce que l'IA sache quelle entreprise elle construit.
    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const updated = await api.companies.get(companyIdForPoll);
        const patch: any = {};
        if (!nameDone && updated?.company?.name && updated.company.name !== provisionalName && updated.company.name !== 'New Project' && updated.company.name !== 'New Project') {
          patch.name = updated.company.name;
          patch.loading = false;
          nameDone = true;
        }
        if (!logoDone && updated?.company?.logo) {
          patch.logo = updated.company.logo;
          logoDone = true;
        }
        if (Object.keys(patch).length) useSidebar.getState().updateProject(companyIdForPoll, patch);
        if (nameDone && logoDone) return;
      } catch {}
    }
    useSidebar.getState().updateProject(companyIdForPoll, { loading: false });
  })();
}

export default function Chat() {
  const { user, updateTokens } = useAuth();
  useSidebar();
  const [, navigate] = useLocation();
  const params = useParams<{ id?: string }>();
  const projectId = params?.id || null;

  // ── Équipe de spécialistes choisie (finance, marketing, …) ─────────────────
  // Persistée en localStorage par projet pour survivre au rechargement, envoyée
  // au backend à chaque message (source de gating). Le bouton « Ajouter ce
  // spécialiste » y ajoute un id puis rejoue la demande.
  const specialistsRef = useRef<string[]>([]);
  useEffect(() => {
    if (!projectId) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`velbaz_specialists_${projectId}`) || '[]');
      if (Array.isArray(saved)) specialistsRef.current = saved.filter((x: any) => typeof x === 'string');
    } catch { /* ignore */ }
  }, [projectId]);
  function persistSpecialists() {
    const key = `velbaz_specialists_${projectId || sessionId}`;
    try { localStorage.setItem(key, JSON.stringify(specialistsRef.current)); } catch { /* ignore */ }
  }

  const build = useBuildStore();
  const isBuildingThis = build.isBuilding && build.companyId === projectId;
  const isBuildingWebsiteThis = build.isBuildingWebsite && build.companyId === projectId;
  const [hasExistingWebsite, setHasExistingWebsite] = useState(false);
  const [isReactProjectChat, setIsReactProjectChat] = useState(false);
  const [siteEditLoading, setSiteEditLoading] = useState(false);
  const [currentPreviewSlug, setCurrentPreviewSlug] = useState('index');
  const previewRefreshKeyRef = useRef(0);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  // Checkpoints (points de restauration) du projet — un par build/édition fini.
  // Servent à afficher une WorkResultCard sous chaque travail terminé.
  const [checkpoints, setCheckpoints] = useState<{ id: string; label: string; kind?: string; createdAt?: any }[]>([]);
  // Garde anti-flicker : plusieurs appels à loadCheckpoints peuvent être en
  // vol en même temps (montage + rappel après build). Sans garde, une
  // réponse LENTE mais LANCÉE AVANT peut arriver APRÈS une réponse plus
  // récente et la remplacer par une liste plus courte/périmée → les
  // rectangles preview disparaissent puis réapparaissent une fois la bonne
  // réponse arrivée. On ignore toute réponse qui n'est plus la dernière
  // demandée, et on n'accepte jamais une liste plus courte que celle déjà
  // affichée pour ce même projet (sauf changement de projet).
  const checkpointsSeqRef = useRef(0);
  const checkpointsProjectRef = useRef<string | null>(null);
  const loadCheckpoints = useCallback(async () => {
    if (!projectId) { checkpointsProjectRef.current = null; setCheckpoints([]); return; }
    const mySeq = ++checkpointsSeqRef.current;
    try {
      const res = await api.companies.checkpoints(projectId);
      if (mySeq !== checkpointsSeqRef.current) return; // réponse périmée, une plus récente est déjà en vol/arrivée
      if (Array.isArray(res?.checkpoints)) {
        setCheckpoints(prev => {
          const sameProject = checkpointsProjectRef.current === projectId;
          checkpointsProjectRef.current = projectId;
          if (sameProject && res.checkpoints.length < prev.length) return prev; // ignore une liste plus courte que l'affichage actuel
          return res.checkpoints;
        });
      }
    } catch {}
  }, [projectId]);
  // Fork terminé → ajoute le nouveau projet à la sidebar et l'ouvre.
  const handleForked = useCallback((newId: string, name: string) => {
    useSidebar.getState().addProject({ id: newId, name, createdAt: new Date(), loading: false });
    navigate(`/chat/${newId}`);
  }, [navigate]);
  // Rollback terminé → rafraîchit l'aperçu, confirme dans le chat (non destructif).
  const handleRolledBack = useCallback((label: string) => {
    setPreviewRefreshKey(k => k + 1);
    setMessages(prev => [...prev, {
      id: `rollback-${Date.now()}`,
      role: 'assistant',
      content: `↩️ Project restored to state "${label}". History is preserved — you can go forward again at any time, or ask me to restore a more recent state.`,
    } as any]);
    setTimeout(loadCheckpoints, 500);
  }, [loadCheckpoints]);
  // Preview panel only appears once the AI has defined the build plan (number of pages / tasks).
  // Before the plan is ready, the chat stays full-width so the user sees what the AI intends to build first.
  const planDefinedThis = build.planReady && build.companyId === projectId;
  // ── Mode expert sans aperçu ── (continuation « directeur financier » etc.)
  // Quand la company est continuée avec des experts NON liés au site (finance,
  // RH, juridique…), il n'y a AUCUN rapport avec un website → on masque
  // totalement le rectangle d'aperçu. Persistant par projet (survit au reload).
  const [noPreviewMode, setNoPreviewMode] = useState(false);
  useEffect(() => {
    if (!projectId) return;
    // Un projet fraîchement créé en mode continuer/expert : persiste le flag.
    if (pendingNoPreviewRef.current !== null) {
      try { localStorage.setItem(`velbaz_no_preview_${projectId}`, pendingNoPreviewRef.current ? '1' : '0'); } catch {}
      setNoPreviewMode(pendingNoPreviewRef.current);
      pendingNoPreviewRef.current = null;
      return;
    }
    try { setNoPreviewMode(localStorage.getItem(`velbaz_no_preview_${projectId}`) === '1'); } catch {}
  }, [projectId]);
  const showPreview = !noPreviewMode && (((isBuildingThis || isBuildingWebsiteThis) && planDefinedThis) || (build.websiteReady && build.companyId === projectId) || hasExistingWebsite);
  // Le vrai aperçu (WebsitePreview, qui SAIT démarrer le serveur Vite) doit
  // s'afficher non seulement quand le store dit websiteReady, mais AUSSI quand
  // le projet a déjà un site en base (projet rouvert : base44 & co.) et qu'on
  // n'est pas en plein build. Sinon on retombait sur le skeleton figé.
  const websiteViewable =
    (build.websiteReady && build.companyId === projectId) ||
    (hasExistingWebsite && !isBuildingThis && !isBuildingWebsiteThis);
  const [panelMode, setPanelMode] = useState<'preview' | 'code' | 'orders'>('preview'); // Toggle between preview, code and orders panel
  // ── Mode auto (autopilot) : quand actif, le panneau de droite affiche le planificateur de tasks IA ──
  const [autoMode, setAutoMode] = useState(false);
  const [autoToggling, setAutoToggling] = useState(false);
  useEffect(() => {
    if (!projectId) return; // pas de projet : on garde l'état local du bouton
    let alive = true;
    fetch(`/api/companies/${projectId}/autopilot/status`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive && d) setAutoMode(!!d.enabled); })
      .catch(() => {});
    return () => { alive = false; };
  }, [projectId]);
  const toggleAutoMode = useCallback(async () => {
    if (autoToggling) return;
    const next = !autoMode;
    // Chat sans projet : le bouton reste utilisable, l'état est mémorisé localement
    // et sera appliqué au projet dès qu'il existe.
    if (!projectId) { setAutoMode(next); return; }
    setAutoToggling(true);
    setAutoMode(next); // optimiste
    try {
      const r = await fetch(`/api/companies/${projectId}/autopilot/${next ? 'enable' : 'disable'}`, { method: 'POST', headers: authHeaders() });
      if (!r.ok) setAutoMode(!next); // rollback
    } catch { setAutoMode(!next); }
    finally { setAutoToggling(false); }
  }, [projectId, autoMode, autoToggling]);

  const [messages, setMessages] = useState<Message[]>([]);
  // ── Moteur /genesis : run de raisonnement en cours (8 phases, streamé en SSE) ──
  const [genesisRun, setGenesisRun] = useState<GenesisRunState | null>(null);
  const [genesisChoiceText, setGenesisChoiceText] = useState('');
  const [genesisChoiceBusy, setGenesisChoiceBusy] = useState(false);
  const [input, setInput] = useState(() => {
    try { return projectId ? (localStorage.getItem('velbaz_draft_input_' + projectId) || '') : ''; } catch { return ''; }
  });
  // ── Persiste le brouillon du prompt par projet : survit au refresh / changement de page ──
  const prevProjectIdRef = useRef(projectId);
  useEffect(() => {
    if (prevProjectIdRef.current === projectId) return;
    prevProjectIdRef.current = projectId;
    try { setInput(projectId ? (localStorage.getItem('velbaz_draft_input_' + projectId) || '') : ''); }
    catch { setInput(''); }
  }, [projectId]);
  useEffect(() => {
    if (!projectId) return;
    try {
      if (input.trim()) localStorage.setItem('velbaz_draft_input_' + projectId, input);
      else localStorage.removeItem('velbaz_draft_input_' + projectId);
    } catch { /* stockage indisponible */ }
  }, [input, projectId]);
  const [chatLoading, setChatLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const streamingContentRef = useRef('');
  // Live build-step cards streamed during an in-project app edit (same visual as
  // company creation). Populated from SSE `buildStep` events, cleared when done.
  const [editSteps, setEditSteps] = useState<Message[]>([]);
  const editStepsRef = useRef<Message[]>([]);
  // Conversation d'équipe IA en direct (événements SSE `teamMsg` pendant un travail d'équipe)
  const [liveTeamMsgs, setLiveTeamMsgs] = useState<TeamMsg[]>([]);
  const liveTeamMsgsRef = useRef<TeamMsg[]>([]);
  // Étapes de travail RÉELLES de l'IA (événements SSE `progress`) — affichées en
  // direct pour que l'utilisateur voie toujours ce que l'IA est en train de faire.
  type ProgressPreview = { kind: 'browse' | 'screenshot' | 'search' | 'code' | 'analyze'; imageUrl?: string; url?: string; caption?: string };
  type ProgressItem = { id: string; label: string; preview?: ProgressPreview };
  const [liveProgress, setLiveProgress] = useState<ProgressItem[]>([]);
  // Vrai quand l'affichage « IA au travail » a été REPRIS depuis le serveur
  // après un rechargement (et non piloté par un envoi de cet onglet).
  const resumedRunRef = useRef(false);
  const liveProgressRef = useRef<ProgressItem[]>([]);
  // « Caméra live » : dernier aperçu reçu (capture réelle d'un site + action en cours).
  const [liveCamera, setLiveCamera] = useState<ProgressPreview | null>(null);
  const liveCameraShotRef = useRef<string | null>(null); // dernière capture connue (persiste)
  const [streamingModel, setStreamingModel] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSocialPanel, setShowSocialPanel] = useState(false);
  const socialTransitionRef = useRef(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // ── Référence de fichiers via "/" dans la barre de prompt ──
  // L'utilisateur tape "/" → un menu liste les fichiers du projet (code généré)
  // + les documents joints. Il choisit un fichier → il devient une "puce" et,
  // à l'envoi, son CHEMIN + son CONTENU sont injectés dans le message pour que
  // l'IA sache précisément de quel fichier on parle.
  type PickedFile = { kind: 'project' | 'attachment'; path: string; name: string; type?: string; attId?: string };
  const [pickedFiles, setPickedFiles] = useState<PickedFile[]>([]);
  const [slashOpen, setSlashOpen] = useState(false);
  // Commande active affichée en petit rectangle dans la barre de prompt (ex. « /genesis »).
  const [cmdChip, setCmdChip] = useState<string | null>(null);
  // Largeur mesurée de la puce : sert à décaler la 1re ligne du textarea pour
  // que le texte tapé commence JUSTE APRÈS le rectangle, sur la même ligne.
  const cmdChipRef = useRef<HTMLSpanElement | null>(null);
  const [cmdChipW, setCmdChipW] = useState(0);
  useEffect(() => {
    if (!cmdChip) { setCmdChipW(0); return; }
    const id = requestAnimationFrame(() => setCmdChipW(cmdChipRef.current?.offsetWidth ?? 0));
    return () => cancelAnimationFrame(id);
  }, [cmdChip]);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const [projFiles, setProjFiles] = useState<Array<{ path: string; name: string; type: string }>>([]);
  const slashStartRef = useRef<number>(-1); // index du "/" déclencheur dans le texte
  const promptBoxRef = useRef<HTMLDivElement>(null); // ancre du menu "/" (box de prompt)
  const [showMediaStudio, setShowMediaStudio] = useState(false);
  const [showAttachPopup, setShowAttachPopup] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pendingPreviews, setPendingPreviews] = useState<{ id: string; name: string; description: string; imageData: string }[] | null>(null);
  const [pendingCompany, setPendingCompany] = useState<{ id: string; name: string; industry?: string; idea?: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [generatingMore, setGeneratingMore] = useState(false);

  // ── Type de projet (web / mobile / both) ──
  // 'mobile' → preview téléphone directe ; 'both' → switch 🌐 Web ⟷ 📱 Phone.
  const [projectType, setProjectType] = useState<'web' | 'mobile' | 'both'>('web');
  const [previewDevice, setPreviewDevice] = useState<'web' | 'phone'>('web');
  // Question « website, mobile app ou les deux ? » quand l'idée est ambiguë.
  const [pendingTypeChoice, setPendingTypeChoice] = useState<{ company: { id: string; name: string; industry?: string; idea?: string } } | null>(null);

  // ── Page-selection questionnaire state ──
  const [pendingPagePlan, setPendingPagePlan] = useState<{ company: { id: string; name: string; industry?: string; idea?: string }; styleRef?: string; pages: any[]; corePages?: any[] } | null>(null);
  const [checkedPages, setCheckedPages] = useState<boolean[]>([]);
  const [customPages, setCustomPages] = useState<{ name: string; purpose: string }[]>([]);

  // Charge le type du projet ouvert (mobile → preview téléphone directe).
  useEffect(() => {
    if (!projectId) { setProjectType('web'); setPreviewDevice('web'); return; }
    let alive = true;
    api.companies.get(projectId).then((res: any) => {
      if (!alive) return;
      const pt = res?.company?.projectType;
      if (pt === 'mobile' || pt === 'both' || pt === 'web') {
        setProjectType(pt);
        setPreviewDevice(pt === 'mobile' ? 'phone' : 'web');
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [projectId]);

  // Recharge les checkpoints à l'ouverture du projet et à chaque fin de
  // build/édition (une carte de résultat par travail terminé).
  useEffect(() => { loadCheckpoints(); }, [loadCheckpoints]);
  useEffect(() => {
    if (!isBuildingThis && !isBuildingWebsiteThis && !chatLoading) {
      const t = setTimeout(loadCheckpoints, 700);
      return () => clearTimeout(t);
    }
  }, [isBuildingThis, isBuildingWebsiteThis, chatLoading, build.websiteReady, loadCheckpoints]);

  const [planningPages, setPlanningPages] = useState(false);
  // ── Étapes de PRÉPARATION live (avant le build) ──
  // Checklist visible dans le chat pendant quickCreate/detectType/previews/planPages,
  // pour que l'utilisateur voie en temps réel ce que l'IA fait au lieu d'un simple spinner.
  // Statuts détectables par TEXTE ([DONE]/[EN COURS]/[ERROR]), jamais par couleur seule.
  type PrepStatus = 'pending' | 'running' | 'done' | 'error';
  const [prepSteps, setPrepSteps] = useState<{ id: string; label: string; status: PrepStatus; detail?: string }[] | null>(null);
  const PREP_LABELS: Record<string, string> = {
    create: 'Project creation',
    detect: 'Project type detection (website / mobile app)',
    previews: 'Style previews generation',
    plan: 'Subject research & page planning',
  };
  const prepStepsRef = useRef<{ id: string; label: string; status: PrepStatus; detail?: string }[] | null>(null);
  function prepStep(id: string, status: PrepStatus, detail?: string) {
    const list = prepStepsRef.current ? [...prepStepsRef.current] : [];
    const i = list.findIndex(s => s.id === id);
    if (i >= 0) list[i] = { ...list[i], status, detail: detail !== undefined ? detail : list[i].detail };
    else list.push({ id, label: PREP_LABELS[id] || id, status, detail });
    prepStepsRef.current = list;
    setPrepSteps(list);
  }
  function resetPrepSteps() { prepStepsRef.current = []; setPrepSteps([]); }
  // Au démarrage du vrai build : fige la checklist de préparation dans le fil de
  // messages (pour garder l'historique visible) puis efface l'état live.
  function finalizePrepSteps() {
    const list = prepStepsRef.current;
    prepStepsRef.current = null;
    setPrepSteps(null);
    if (!list || list.length === 0) return;
    const lines = list.map(s =>
      `- [${s.status === 'done' ? 'DONE' : s.status === 'error' ? 'ERROR' : s.status === 'running' ? 'DONE' : 'SKIPPED'}] ${s.label}${s.detail ? ` — ${s.detail}` : ''}`);
    setMessages(msgs => [...msgs, {
      id: `prep-summary-${Date.now()}`, role: 'assistant',
      content: `**Setup complete:**\n${lines.join('\n')}`,
      model: 'velbaz', time: new Date(), isBuildStep: true,
    }]);
  }

  // ── Question popup state ──
  const [pendingQuestions, setPendingQuestions] = useState<QuestionConfig[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [questionAnswers, setQuestionAnswers] = useState<Record<number, string>>({});


  // ── AI Approval popup state ──
  const [pendingApproval, setPendingApproval] = useState<{ decision: string; agentRole: string; approvalId: string } | null>(null);

  // ── AI-triggered popup state (confirm/preview/choice/alert/progress/secret/recap/info) ──
  const [pendingPopup, setPendingPopup] = useState<PopupConfig | null>(null);

  // ── Clear popup state when switching projects (component is a singleton) ──
  const prevProjectForPopupsRef = useRef(projectId);
  useEffect(() => {
    if (prevProjectForPopupsRef.current !== projectId) {
      setPendingQuestions([]);
      setQuestionIndex(0);
      setQuestionAnswers({});
      setPendingApproval(null);
      setPendingPopup(null);
      setPendingPreviews(null);
      setPendingCompany(null);
      setPendingPagePlan(null);
      setCheckedPages([]);
      setCustomPages([]);
      prevProjectForPopupsRef.current = projectId;
    }
  }, [projectId]);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const voice = useVoiceInput(useCallback((text: string) => setInput(text), []));
  const [stableSessionId] = useState(() => {
    if (typeof window === 'undefined') return `session-${Date.now()}`;
    const stored = localStorage.getItem('velbaz_session_id');
    if (stored) return stored;
    const newId = `session-${Date.now()}`;
    localStorage.setItem('velbaz_session_id', newId);
    return newId;
  });
  const sessionId = projectId || stableSessionId;

  // Upsert an assistant message in the chat feed (used by the Media Studio).
  // Stable id (hf-<jobId>) so a live "generating" card is replaced in place by
  // the final media, and matches the backend-persisted message on reload.
  const upsertHiggsfieldMessage = useCallback((id: string, content: string) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === id);
      if (idx === -1) {
        return [...prev, { id, role: 'assistant' as const, content, model: 'higgsfield', time: new Date() }];
      }
      const copy = [...prev];
      copy[idx] = { ...copy[idx], content };
      return copy;
    });
  }, []);

  // ── Model tier selector ──
  type ModelTier = 'max' | 'pro' | 'lite';
  const [modelTier, setModelTier] = useState<ModelTier>(() => (localStorage.getItem('velbaz_model_tier') as ModelTier) || 'max');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [pickerClosing, setPickerClosing] = useState(false);
  const pickerCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ── Plan mode ──
  const [planMode, setPlanMode] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [planData, setPlanData] = useState<{ title: string; summary?: string; steps: { title: string; description?: string }[] } | null>(null);
  const [planOriginalMsg, setPlanOriginalMsg] = useState('');
  const [planDetailsMode, setPlanDetailsMode] = useState(false);
  const [planDetailsInput, setPlanDetailsInput] = useState('');
  // Plan pré-build obligatoire : quand true, la validation du plan lance triggerBuild
  const [planForBuild, setPlanForBuild] = useState(false);

  // ── Persistance des pop-ups / plans EN ATTENTE (par projet) ──────────────────
  // Sans ça : une pop-up ou un plan affiché par l'IA DISPARAÎT au refresh /
  // changement de page, et l'IA "oublie" ce qu'elle attendait. On sauvegarde
  // l'état en attente dans localStorage et on le RESTAURE au chargement, pour que
  // l'utilisateur retrouve exactement la pop-up / le plan et puisse répondre.
  const PENDING_UI_KEY = (pid: string) => `velbaz_pending_ui_${pid}`;
  const pendingUiRestoredRef = useRef<string | null>(null);
  const pendingUiSavePrimedRef = useRef<string | null>(null);
  // Restauration (au montage + à chaque changement de projet)
  useEffect(() => {
    if (!projectId) return;
    if (pendingUiRestoredRef.current === projectId) return;
    pendingUiRestoredRef.current = projectId;
    let s: any = null;
    try { const raw = localStorage.getItem(PENDING_UI_KEY(projectId)); if (raw) s = JSON.parse(raw); } catch { /* noop */ }
    if (!s) return;
    try {
      if (Array.isArray(s.pendingQuestions) && s.pendingQuestions.length) {
        setPendingQuestions(s.pendingQuestions);
        if (typeof s.questionIndex === 'number') setQuestionIndex(s.questionIndex);
        if (s.questionAnswers) setQuestionAnswers(s.questionAnswers);
      }
      if (s.pendingPopup) setPendingPopup(s.pendingPopup);
      if (s.pendingApproval) setPendingApproval(s.pendingApproval);
      if (s.planData) {
        setPlanData(s.planData);
        setPlanOriginalMsg(s.planOriginalMsg || '');
        if (typeof s.planForBuild === 'boolean') setPlanForBuild(s.planForBuild);
      }
      if (s.pendingCompany) setPendingCompany(s.pendingCompany);
      if (s.pendingPagePlan) {
        setPendingPagePlan(s.pendingPagePlan);
        if (Array.isArray(s.checkedPages)) setCheckedPages(s.checkedPages);
        if (Array.isArray(s.customPages)) setCustomPages(s.customPages);
      }
      if (s.pendingPreviews) setPendingPreviews(s.pendingPreviews);
    } catch { /* noop */ }
  }, [projectId]);
  // Sauvegarde (à chaque changement d'un état en attente)
  useEffect(() => {
    if (!projectId) return;
    // On saute le TOUT PREMIER commit d'un projet : sinon on écraserait le
    // stockage avec des états encore vides AVANT que la restauration ci-dessus
    // n'ait ré-appliqué les valeurs sauvegardées.
    if (pendingUiSavePrimedRef.current !== projectId) {
      pendingUiSavePrimedRef.current = projectId;
      return;
    }
    try {
      const hasAny = pendingQuestions.length || pendingPopup || pendingApproval || planData || pendingCompany || pendingPagePlan || pendingPreviews;
      if (hasAny) {
        localStorage.setItem(PENDING_UI_KEY(projectId), JSON.stringify({
          pendingQuestions, questionIndex, questionAnswers,
          pendingPopup, pendingApproval,
          planData, planOriginalMsg, planForBuild,
          pendingCompany, pendingPagePlan, checkedPages, customPages,
          pendingPreviews,
        }));
      } else {
        localStorage.removeItem(PENDING_UI_KEY(projectId));
      }
    } catch { /* quota / stockage indisponible */ }
  }, [projectId, pendingQuestions, questionIndex, questionAnswers, pendingPopup, pendingApproval, planData, planOriginalMsg, planForBuild, pendingCompany, pendingPagePlan, checkedPages, customPages, pendingPreviews]);
  // ── Flux conversationnel de création de pub (Higgsfield) ──
  // Pop-up au-dessus de la barre de saisie (même patron visuel que le Plan).
  // On ne pose QUE les questions dont la réponse manque, puis on route vers
  // les choix Higgsfield (avatar, voix) pour le style UGC, puis on génère.
  type AdAnswers = {
    subject?: string;   // app ou produit à promouvoir
    style?: string;     // 'ugc' | 'motion' | 'autre'
    avatarId?: string;  // Higgsfield Soul ID (UGC)
    avatarName?: string;
    voice?: string;     // voix (UGC)
    format?: string;    // '9:16' | '16:9' | '1:1'
    duration?: string;  // 'court' | 'moyen' | 'long'
    language?: string;
    message?: string;   // accroche / hook
  };
  const [adFlow, setAdFlow] = useState<null | { answers: AdAnswers }>(null);
  const [adAvatars, setAdAvatars] = useState<{ id: string; name: string; preview_url?: string; thumbnail_url?: string }[]>([]);
  const [adAvatarsLoading, setAdAvatarsLoading] = useState(false);
  const [adTextInput, setAdTextInput] = useState('');
  const [adSubmitting, setAdSubmitting] = useState(false);
  const [tierPickerPos, setTierPickerPos] = useState<{ bottom: number; right: number } | null>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const MODEL_TIERS: { id: ModelTier; label: string; desc: string; tokens: string }[] = [
    { id: 'max',  label: TIER_MAX,  desc: 'Most powerful models',    tokens: '3× tokens' },
    { id: 'pro',  label: TIER_PRO,  desc: 'Good power/cost balance',  tokens: '2× tokens' },
    { id: 'lite', label: TIER_LITE, desc: 'Light and economical',            tokens: '1× tokens' },
  ];
  const currentTier = MODEL_TIERS.find(t => t.id === modelTier)!;

  // Ferme le sélecteur en jouant d'abord l'animation de sortie
  function closeTierPicker() {
    if (pickerClosing) return;
    setPickerClosing(true);
    if (pickerCloseTimer.current) clearTimeout(pickerCloseTimer.current);
    pickerCloseTimer.current = setTimeout(() => {
      setShowModelPicker(false);
      setPickerClosing(false);
    }, isMobile ? 155 : 95);
  }

  useEffect(() => () => { if (pickerCloseTimer.current) clearTimeout(pickerCloseTimer.current); }, []);

  function openTierPicker() {
    if (showModelPicker) { closeTierPicker(); return; }
    if (pickerCloseTimer.current) clearTimeout(pickerCloseTimer.current);
    setPickerClosing(false);
    // Sur desktop : popover ancré au bouton. Sur téléphone : on ouvre une
    // "bottom sheet" plein écran (pas de calcul de position → jamais hors écran
    // ni masquée par le clavier). D'où pas de getBoundingClientRect en mobile.
    if (!isMobile && modelBtnRef.current) {
      const r = modelBtnRef.current.getBoundingClientRect();
      setTierPickerPos({ bottom: window.innerHeight - r.top + 8, right: window.innerWidth - r.right });
    }
    setShowModelPicker(true);
  }

  // Close model picker on outside click
  useEffect(() => {
    if (!showModelPicker) return;
    const handler = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node) &&
          modelBtnRef.current && !modelBtnRef.current.contains(e.target as Node)) {
        closeTierPicker();
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showModelPicker]);

  const [loadingHistory, setLoadingHistory] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // L'utilisateur est-il "collé" en bas ? On ne fait défiler automatiquement
  // que dans ce cas. Dès qu'il remonte manuellement, on n'impose plus rien.
  const stickToBottomRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const finishQuestions = useCallback((answers: Record<number, string>) => {
    // Build a reply with answered questions + explicit skip markers
    const parts: string[] = [];
    let hasSkipped = false;
    pendingQuestions.forEach((q, i) => {
      if (answers[i]) {
        parts.push(`${q.q}: ${answers[i]}`);
      } else {
        hasSkipped = true;
      }
    });
    // If some were skipped, tell the AI to decide for them — don't re-ask
    let reply: string;
    if (parts.length === 0) {
      reply = "I'll skip these questions — decide for yourself and launch directly. Go!";
    } else if (hasSkipped) {
      reply = parts.join(' | ') + " | For the rest, decide for yourself — don't ask me again.";
    } else {
      reply = parts.join(' | ');
    }
    setPendingQuestions([]);
    setQuestionIndex(0);
    setQuestionAnswers({});
    // Send the compiled answer
    setTimeout(() => doSend(reply), 50);
  }, [pendingQuestions]);

  const openFilePicker = useCallback(() => {
    window.setTimeout(() => fileInputRef.current?.click(), 0);
  }, []);

  const openImagePicker = useCallback(() => {
    window.setTimeout(() => imageInputRef.current?.click(), 0);
  }, []);

  /* ─── Preview Panel Resize (drag from left edge) ─── */
  const containerRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [previewWidth, setPreviewWidth] = useState(58); // % of container
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [leftBarOpen, setLeftBarOpen] = useState(false);
  const isDragging = useRef(false);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(58);

  const MIN_PREVIEW = 25; // min % when visible
  const MAX_PREVIEW = 85; // max % — can't push chat off screen
  const COLLAPSE_THRESHOLD = 18; // below this % → collapse

  const onDragStart = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    // Screenshot the pointer on the handle itself: this keeps delivering
    // pointermove/pointerup events to it even when the cursor crosses into
    // the preview iframe (which has its own document and would otherwise
    // swallow mousemove/mouseup — that's what left the drag stuck "on"
    // forever, or made it skip updates, whenever the cursor passed over
    // the site preview).
    try { handle.setPointerScreenshot(e.pointerId); } catch { /* ignore */ }

    isDragging.current = true;
    setIsDraggingState(true);
    dragStartX.current = e.clientX;
    dragStartWidth.current = previewWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: PointerEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const containerW = containerRef.current.offsetWidth;
      const dx = dragStartX.current - ev.clientX; // moving left = positive dx = bigger preview
      const newPct = dragStartWidth.current + (dx / containerW) * 100;

      if (newPct < COLLAPSE_THRESHOLD) {
        setPanelCollapsed(true);
        setPreviewWidth(MIN_PREVIEW);
      } else {
        setPanelCollapsed(false);
        setPreviewWidth(Math.min(MAX_PREVIEW, Math.max(MIN_PREVIEW, newPct)));
      }
    };

    const stop = () => {
      isDragging.current = false;
      setIsDraggingState(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
      try { handle.releasePointerScreenshot(e.pointerId); } catch { /* ignore */ }
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    // Safety net: if the drag somehow never gets a pointerup (window loses
    // focus mid-drag), stop it anyway instead of leaving it stuck scaling.
    window.addEventListener('blur', stop);
  }, [previewWidth]);

  const restorePanel = useCallback(() => {
    setPanelCollapsed(false);
    setPreviewWidth(58);
  }, []);

  // Sur téléphone : la preview n'occupe pas un demi-écran (illisible). Dès
  // qu'elle devient disponible, on la replie en rectangle cliquable ; l'utilisateur
  // la rouvre en plein écran via la flèche →. On ne le fait qu'une fois par preview.
  const mobilePreviewInit = useRef(false);
  useEffect(() => {
    if (isMobile && showPreview && !mobilePreviewInit.current) {
      mobilePreviewInit.current = true;
      setPanelCollapsed(true);
    }
    if (!showPreview) mobilePreviewInit.current = false;
  }, [isMobile, showPreview]);

  const allMessages = useMemo(() => {
    // Live in-project edit steps render as task cards, merged in chronologically.
    const withEdit = editSteps.length > 0
      ? [...messages, ...editSteps].sort((a, b) => a.time.getTime() - b.time.getTime())
      : messages;
    if (!isBuildingThis && build.companyId !== projectId) return withEdit;
    const buildMsgs = build.buildMessages;
    const buildIds = new Set(buildMsgs.map(m => m.id));
    // Also detect done-message duplicates by content pattern (different IDs, same content)
    const hasBuildDone = buildMsgs.some(m => m.id.startsWith('done-') || m.content?.includes('company is ready') || m.content?.includes('Build had issues'));
    // Le message marketing peut exister à la fois en DB (historique) et en live
    // (buildMessages). S'il est présent en live, on filtre la copie historique
    // pour éviter le doublon.
    const hasBuildMarketing = buildMsgs.some(m => m.id.startsWith('marketing-'));
    const filtered = messages.filter(m => {
      if (buildIds.has(m.id)) return false;
      // If live build messages cover this activity, skip the historical version
      if ((m as any).isBuildStep && m.id.startsWith('activity-') && buildIds.has(m.id)) return false;
      // If build messages already have a done message, filter out any duplicate done from chat messages
      if (hasBuildDone && (m.content?.includes('company is ready') || m.content?.includes('Build had issues') || m.content?.includes('are live'))) return false;
      // Éviter le doublon du message marketing (live vs historique)
      if (hasBuildMarketing && m.content?.includes('[FILE:marketing/')) return false;
      return true;
    });
    // Merge chronologically instead of appending build messages at the end,
    // so a new user message never "teleports" old build tasks below it.
    return [...filtered, ...buildMsgs].sort((a, b) => a.time.getTime() - b.time.getTime());
  }, [messages, editSteps, build.buildMessages, build.companyId, projectId, isBuildingThis]);

  // Suit le scroll de l'utilisateur : s'il est proche du bas on reste "collé",
  // dès qu'il remonte on désactive le défilement automatique.
  const handleMessagesScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  };

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages, streamingContent, pendingPreviews, previewLoading]);

  // ── After website is built → user clicks "Next" button to open social connect panel ──
  useEffect(() => {
    if (!build.websiteReady || build.companyId !== projectId) {
      socialTransitionRef.current = false;
      setShowSocialPanel(false);
    }
  }, [build.websiteReady, build.companyId, projectId]);

  // ── PHASE 9 du moteur /genesis : boucle de conformité visuelle ──────────
  // Quand la construction issue d'un run /genesis est terminée, on fait
  // regarder la page réellement construite par un juge visuel qui la compare
  // à la maquette validée avant le code. S'il n'est pas conforme, ses
  // corrections repartent en brief caché vers l'agent de code. Max 3 cycles.
  const genesisVerifyCyclesRef = useRef(0);
  const genesisVerifyBusyRef = useRef(false);
  useEffect(() => {
    if (!genesisRun || !projectId) return;
    if (genesisRun.status !== 'done') return;
    if (!(build.websiteReady && build.companyId === projectId)) return;
    if (build.isBuilding || build.isBuildingWebsite || chatLoading) return;
    if (genesisVerifyBusyRef.current || genesisVerifyCyclesRef.current >= 3) return;
    const mock = [...genesisRun.assets].reverse().find((a: any) => a.role === 'mockup');
    if (!mock?.url) return;
    genesisVerifyBusyRef.current = true;
    (async () => {
      try {
        const res = await fetch('/api/genesis/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ companyId: projectId, mockup: mock.url, intent: genesisRun.brief }),
        });
        const data = await res.json().catch(() => null);
        const fixes: string[] = Array.isArray(data?.corrections) ? data.corrections.filter(Boolean) : [];
        if (data?.ok && !data.conform && fixes.length) {
          genesisVerifyCyclesRef.current += 1;
          doSend(
            `Contrôle de conformité visuelle de la page construite (cycle ${genesisVerifyCyclesRef.current}/3) : la page s'écarte de la composition de référence validée avant le code. Applique EXACTEMENT ces corrections dans le code existant, sans rien reconstruire d'autre, sans changer le contenu textuel, sans changer les images utilisées :\n- ${fixes.join('\n- ')}\n\nAucune autre modification.`,
            undefined,
            { hidden: true },
          );
        } else {
          // Conforme (ou juge indisponible) : on arrête définitivement la boucle.
          genesisVerifyCyclesRef.current = 99;
        }
      } catch (e: any) {
        console.warn('[genesis] phase 9 KO →', e?.message);
        genesisVerifyCyclesRef.current = 99;
      } finally {
        genesisVerifyBusyRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genesisRun, projectId, build.websiteReady, build.companyId, build.isBuilding, build.isBuildingWebsite, chatLoading]);

  const goToSocialPanel = () => {
    socialTransitionRef.current = true;
    setShowSocialPanel(true);
    if (build.socialPhase === 'none') {
      build.setSocialPhase('connecting');
    }
  };

  // ── Check if project already has a website (for site-edit mode) ──
  useEffect(() => {
    // New Project affiché → on autorise à nouveau l'aperçu de marque.
    brandGateDoneRef.current = false;
    if (!projectId) { setHasExistingWebsite(false); setIsReactProjectChat(false); return; }
    (async () => {
      try {
        // Check for React project files first
        const pfRes = await fetch(`/api/companies/${projectId}/project-files`, { headers: authHeaders() }).then(r => r.json()).catch(() => ({ files: [] }));
        const hasProjectFiles = pfRes.files && pfRes.files.length > 3;
        setIsReactProjectChat(hasProjectFiles);

        const res = await api.companies.pages(projectId);
        const pages = (res.pages || []).filter((p: any) => p.htmlContent && p.htmlContent.length > 100);
        setHasExistingWebsite(hasProjectFiles || pages.length > 0);
      } catch { setHasExistingWebsite(false); setIsReactProjectChat(false); }
    })();
  }, [projectId, build.websiteReady]);

  const prevProjectIdForHistoryRef = useRef<string | null>(undefined as any);

  useEffect(() => {
    const prev = prevProjectIdForHistoryRef.current;
    prevProjectIdForHistoryRef.current = projectId;
    if (prev === projectId) return;

    // When navigating from temp session (prev=undefined/null) to a project with existing messages,
    // keep current messages instead of clearing+reloading (avoids duplication after triggerBuild navigate)
    // Also skip if a build was just triggered — triggerBuild already migrated messages
    const skipHistoryLoad = ((prev === null || prev === undefined) && projectId && messages.length > 0) || buildTriggeredRef.current || continueFlowRef.current;

    if (!skipHistoryLoad) {
      setChatLoading(false);
      setStreamingContent('');
      if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
      if (!projectId) { setMessages([]); return; }
      setLoadingHistory(true);

      // Load history with retry — migration may still be in-flight after triggerBuild navigation
      const loadHistory = async (retries = 3): Promise<any[]> => {
        const res: any = await api.chat.history(projectId).catch(() => ({ messages: [] }));
        const msgs = res.messages || [];
        if (msgs.length === 0 && retries > 0) {
          await new Promise(r => setTimeout(r, 600));
          return loadHistory(retries - 1);
        }
        return msgs;
      };

      // Fetch both chat history and build activity in parallel
      const ACTIVITY_ROLE_MODEL: Record<string, string> = {
        engineering: 'claude-opus-4.7', engineer: 'claude-opus-4.7',
        design: 'claude-opus-4.7', ceo: 'velbaz',
        marketing: 'gemini-3.1-pro', growth: 'gemini-3.1-pro',
        support: 'claude-opus-4.7', supply_chain: 'claude-opus-4.7',
      };

      Promise.all([
        loadHistory(),
        api.companies.jobs(projectId).catch(() => ({ latestActivity: [] })),
      ]).then(([rawMsgs, jobsRes]: [any[], any]) => {
        // ── Parse chat messages ──
        let parsed: Message[] = [];
        if (rawMsgs.length > 0) {
          // Detect [BUILD_PENDING] marker from DB and restore to sessionStorage
          const pendingMsg = rawMsgs.find((m: any) => m.role === 'system' && (m.content || '').includes('[BUILD_PENDING]'));
          if (pendingMsg) {
            const match = (pendingMsg.content || '').match(/\[BUILD_PENDING\]([\s\S]*?)\[\/BUILD_PENDING\]/);
            if (match && match[1] && !sessionStorage.getItem('velbaz_build_pending')) {
              sessionStorage.setItem('velbaz_build_pending', JSON.stringify({ idea: match[1], timestamp: Date.now() }));
            }
          }

          // Le dernier message est une réponse de l'IA qui posait des questions
          // et l'utilisateur n'y a pas encore répondu → on réaffiche le
          // formulaire (il survit maintenant à un rechargement de page ou à une
          // coupure du flux entre l'accueil et /chat/<id>).
          const nonSystem = rawMsgs.filter((m: any) => m.role !== 'system');
          const lastMsg = nonSystem[nonSystem.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            const restoredQs = parseQuestionsFromContent(lastMsg.content || '');
            if (restoredQs) {
              setPendingQuestions(restoredQs);
              setQuestionIndex(0);
              setQuestionAnswers({});
            }
          }

          parsed = rawMsgs
            .filter((m: any) => m.role !== 'system')
            .map((m: any) => {
              let content = sanitizeHistoryContent(m.content || '')
                .replace(/\[QUESTIONS_ASKED\]/g, '')
                .replace(/\[QUESTIONS\][\s\S]*\[\/QUESTIONS\]/g, '')
                .replace(/\[QUESTIONS\][\s\S]*$/g, '')
                .replace(/\[\/QUESTIONS\]/g, '')
                .replace(/\[BUILD_COMPANY\]/g, '')
                // Plan en phases : le marqueur caché [PLAN_DATA] et le [POPUP] de
                // validation ne doivent jamais s'afficher en texte brut au reload.
                .replace(/\[PLAN_DATA\][\s\S]*?\[\/PLAN_DATA\]/g, '')
                .replace(/\[PLAN_DATA\][\s\S]*$/g, '')
                .replace(/\[POPUP\][\s\S]*?\[\/POPUP\]/g, '')
                .replace(/\[POPUP\][\s\S]*$/g, '')
                .trim();
              return {
                id: m.id, role: m.role as 'user' | 'assistant', content,
                model: m.model || undefined, time: parseMsgTime(m),
              };
            }).filter((m: any) => m.content);
        }

        // ── Convert agent_activity entries to build step messages ──
        const activity = (jobsRes as any).latestActivity || [];
        if (activity.length > 0) {
          const chronological = [...activity].reverse(); // oldest first
          const buildSteps: Message[] = chronological.map((act: any) => {
            const content = act.message || '';
            const model = ACTIVITY_ROLE_MODEL[act.agentRole] || 'velbaz';
            const roleName = act.agentRole === 'design' ? 'Design Agent'
              : act.agentRole === 'engineer' || act.agentRole === 'engineering' ? 'Engineering Agent'
              : act.agentRole === 'ceo' ? 'CEO Agent'
              : act.agentRole === 'marketing' ? 'Marketing Agent'
              : act.agentRole === 'supply_chain' ? 'Supply Chain Agent'
              : act.agentRole || 'Agent';
            let reasoning: string | undefined;
            if (act.action === 'executing') reasoning = `${roleName} is working on this...`;
            else if (act.action === 'completed') reasoning = `${roleName} — done`;
            else if (act.action === 'spawned') reasoning = `${roleName} activated`;
            else if (act.action === 'error') reasoning = `${roleName} encountered an issue — retrying...`;

            return {
              id: `activity-${act.id}`,
              role: 'assistant' as const,
              content,
              model,
              time: new Date(act.createdAt),
              isBuildStep: true,
              reasoning,
            };
          }).filter((m: Message) => m.content);

          // ── Merge chronologically: chat messages + build steps ──
          const merged = [...parsed, ...buildSteps].sort((a, b) => a.time.getTime() - b.time.getTime());
          setMessages(merged);
        } else if (parsed.length > 0) {
          setMessages(parsed);
        } else {
          setMessages(prev => prev.length > 0 ? prev : []);
        }
      }).catch(() => {}).finally(() => setLoadingHistory(false));
    }

    // Resume build polling if there are active jobs or no website pages yet
    if (projectId) {
      // Flux « Continuer » en cours : c'est runBuild (déclenché après le scrape
      // Firecrawl) qui lancera le polling. Un resume ici (déclenché par la
      // navigation de pré-création, AVANT que le build existe côté serveur)
      // voyait « rien ne tourne » et cassait l'affichage → on le saute.
      if (continueFlowRef.current) {
        // no-op : runBuild s'en charge
      } else if (build.isBuilding && build.companyId === projectId) {
        // Build is already running — no need to resume
      } else {
        // Check both pages AND active jobs to decide whether to resume
        Promise.all([
          api.companies.pages(projectId).catch(() => ({ pages: [] })),
          api.companies.jobs(projectId).catch(() => ({ jobs: [], executions: [] })),
        ]).then(([pagesRes, jobsRes]: [any, any]) => {
          const pages = (pagesRes.pages || []).filter((p: any) => p.htmlContent && p.htmlContent.length > 100);
          const jobs = jobsRes.jobs || [];
          const executions = jobsRes.executions || [];
          const hasRunningJobs = jobs.some((j: any) => j.status === 'running' || j.status === 'queued');
          const hasRunningExecs = executions.some((e: any) => e.status === 'running');
          // Server-authoritative completion: a build is only truly "done" when the
          // website record is COMPLETED — never infer "complete" from "pages exist
          // + no job running right now". On mobile you can return between build
          // phases (jobs momentarily empty while skeleton pages are already
          // persisted); inferring completion there falsely shows "task complete".
          const websiteJob = jobs.find((j: any) => j.type === 'build-website');
          const websiteExec = executions.find((e: any) => e.type === 'build-website');
          const websiteCompleted = websiteJob?.status === 'completed' || websiteExec?.status === 'completed';
          const anyRecordExists = jobs.length > 0 || executions.length > 0;

          if (hasRunningJobs || hasRunningExecs) {
            // Active work on the server — resume live polling.
            build.resumeBuild(projectId);
          } else if (websiteCompleted) {
            // Server confirms the website finished — safe to show the preview.
            build.markWebsiteReady(projectId);
          } else if (pages.length > 0 && !anyRecordExists) {
            // Legacy project with real pages but no job/exec records at all —
            // treat as finished so the preview isn't stuck on a skeleton.
            build.markWebsiteReady(projectId);
          } else {
            // Pages may exist but completion is NOT confirmed (mid-phase gap, or
            // nothing built yet) — resume/re-check instead of faking "done".
            build.resumeBuild(projectId);
          }
        }).catch(() => {
          // On error, try to resume anyway (safe fallback)
          build.resumeBuild(projectId);
        });
      }
    }
  }, [projectId]);

  // Previews de thèmes/styles supprimées : on nettoie toute trace résiduelle en sessionStorage.
  useEffect(() => {
    sessionStorage.removeItem('velbaz_pending_previews');
    sessionStorage.removeItem('velbaz_pending_company');
  }, [projectId]);

  // ── Mobile resilience: recover replies the server finished while we were away ──
  // The server computes the reply and PERSISTS it to the DB BEFORE streaming it,
  // and its AI calls are NOT tied to the request connection. So when the phone
  // kills the SSE stream (going to the dashboard, locking the screen, switching
  // apps), the work still finishes server-side. This pulls any assistant replies
  // saved after we lost the connection and appends the ones we don't already
  // have — instead of showing a frozen loader or a false "interrupted" message.
  // Returns the number of new assistant messages recovered.
  const syncMissedReplies = useCallback(async (): Promise<number> => {
    if (!projectId) return 0;
    const res: any = await api.chat.history(projectId).catch(() => ({ messages: [] }));
    const msgs = res.messages || [];
    if (!msgs.length) return 0;
    let recovered = 0;
    setMessages(prev => {
      const haveIds = new Set(prev.map(m => m.id));
      const additions: Message[] = [];
      for (const m of msgs) {
        if (m.role === 'system') continue;
        if (haveIds.has(m.id)) continue;
        const content = sanitizeHistoryContent(m.content || '')
          .replace(/\[QUESTIONS_ASKED\]/g, '')
          .replace(/\[QUESTIONS\][\s\S]*\[\/QUESTIONS\]/g, '')
          .replace(/\[QUESTIONS\][\s\S]*$/g, '')
          .replace(/\[\/QUESTIONS\]/g, '')
          .replace(/\[BUILD_COMPANY\]/g, '')
          .replace(/\[PLAN_DATA\][\s\S]*?\[\/PLAN_DATA\]/g, '')
          .replace(/\[PLAN_DATA\][\s\S]*$/g, '')
          .replace(/\[POPUP\][\s\S]*?\[\/POPUP\]/g, '')
          .replace(/\[POPUP\][\s\S]*$/g, '')
          .trim();
        if (!content) continue;
        if (m.role === 'assistant') recovered++;
        additions.push({ id: m.id, role: m.role as 'user' | 'assistant', content, model: m.model || undefined, time: parseMsgTime(m) });
      }
      if (!additions.length) return prev;
      return [...prev, ...additions].sort((a, b) => a.time.getTime() - b.time.getTime());
    });
    // Réponse récupérée depuis la base alors que le flux avait été coupé : si
    // l'IA posait des questions, on affiche le formulaire au lieu de laisser
    // une intro « j'ai quelques questions » sans rien derrière.
    const lastServerMsg = msgs.filter((m: any) => m.role !== 'system').slice(-1)[0];
    if (lastServerMsg && lastServerMsg.role === 'assistant') {
      const restoredQs = parseQuestionsFromContent(lastServerMsg.content || '');
      if (restoredQs) {
        setPendingQuestions(restoredQs);
        setQuestionIndex(0);
        setQuestionAnswers({});
      }
    }
    return recovered;
  }, [projectId]);

  // ── REPRISE APRÈS RECHARGEMENT : l'IA travaille toujours côté serveur ──────
  // Avant, recharger la page (ou un redémarrage du serveur de dev) pendant que
  // l'IA travaillait laissait un chat MUET : plus d'animation, plus de liste de
  // tâches, la réponse tombait d'un coup à la fin. Le serveur garde désormais
  // une trace du run en cours (/api/chat/active/:sessionId) : au chargement on
  // la relit et on rebranche exactement le même affichage — animation « en
  // train de travailler » + les tâches déjà faites — puis on récupère la
  // réponse dès qu'elle est enregistrée.
  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;
    let timer: any = null;

    const poll = async () => {
      if (stopped) return;
      // Un envoi en cours dans CET onglet gère déjà son propre flux : on ne
      // touche à rien pour ne pas dupliquer l'affichage.
      if (sendingRef.current) { timer = setTimeout(poll, 3000); return; }
      let data: any = null;
      try {
        const r = await fetch(`/api/chat/active/${sessionId}`, { headers: authHeaders() });
        data = await r.json();
      } catch { data = null; }
      if (stopped) return;

      if (data?.active) {
        resumedRunRef.current = true;
        setChatLoading(true);
        const steps: ProgressItem[] = (data.steps || [])
          .filter((p: any) => p && (p.label || typeof p === 'string'))
          .map((p: any, i: number) => (typeof p === 'string'
            ? { id: `r-${i}-${p}`, label: p }
            : { id: String(p.id || p.label || i), label: String(p.label), preview: p.preview }));
        if (steps.length) { liveProgressRef.current = steps; setLiveProgress(steps); }
        timer = setTimeout(poll, 2500);
        return;
      }

      // Plus de run actif : soit il vient de finir (réponse en base), soit le
      // serveur a redémarré et le travail est perdu.
      if (resumedRunRef.current) {
        resumedRunRef.current = false;
        setChatLoading(false);
        liveProgressRef.current = [];
        setLiveProgress([]);
        const recovered = await syncMissedReplies().catch(() => 0);
        if (!recovered) {
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') return prev;
            return [...prev, {
              id: `a-int-${Date.now()}`, role: 'assistant', model: 'velbaz', time: new Date(),
              content: "La connexion s'est coupée pendant que je travaillais et ma réponse a été perdue. Dis-moi « continue » et je reprends là où j'en étais.",
            }];
          });
        }
      }
      timer = setTimeout(poll, 4000);
    };

    poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [sessionId, syncMissedReplies]);

  // ── Mobile resilience: re-sync from the server on return to foreground ──
  // On mobile, navigating to the dashboard, locking the screen or switching apps
  // suspends this tab: the SSE chat stream is killed and the build poll pauses.
  // When we come back we re-sync from the authoritative server so the UI never
  // looks "stopped" or falsely "complete". The server is the single source of
  // truth for build state (resumeBuild re-checks it) and for saved replies.
  useEffect(() => {
    if (!projectId) return;
    let wasHidden = document.visibilityState === 'hidden';
    const onReturn = () => {
      if (document.visibilityState !== 'visible') { wasHidden = true; return; }
      if (!wasHidden) return;
      wasHidden = false;
      // 1) Build: re-poll the server and resume/finalize from real job state.
      try { build.resumeBuild(projectId); } catch {}
      // 2) Chat/edit stream: if a send was in-flight, the mobile OS likely killed
      //    the connection. Drop the dead stream and recover the reply the server
      //    already finished + saved, instead of leaving a stuck loader.
      if (sendingRef.current) {
        if (abortRef.current) { try { abortRef.current.abort(); } catch {} abortRef.current = null; }
        sendingRef.current = false;
        setChatLoading(false);
        setSiteEditLoading(false);
        setStreamingContent('');
        streamingContentRef.current = '';
        syncMissedReplies().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('pageshow', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('pageshow', onReturn);
    };
  }, [projectId, syncMissedReplies]);

  const ideaConsumedRef = useRef(false);
  // Flux « Continuer une company » ACTIF : tant qu'il est vrai, l'effet de
  // rechargement d'historique NE recharge PAS et NE relance PAS de polling
  // concurrent. Sans ça, la navigation /chat → /chat/:id (pré-création du
  // projet) déclenchait un reload qui EFFAÇAIT le chat + un resume au mauvais
  // moment → « tout disparaît puis rien ne continue ». runBuild reprend la main
  // sur le polling et remet ce drapeau à false une fois le build démarré.
  const continueFlowRef = useRef(false);
  // Mémorise le « pas d'aperçu » du mode continuer jusqu'à ce que le projet soit
  // créé (projectId), puis on le persiste par projet.
  const pendingNoPreviewRef = useRef<boolean | null>(null);
  useEffect(() => {
    // Guard against React StrictMode double-mount
    if (ideaConsumedRef.current) return;

    // ── Mode « Continuer une company » (config passée depuis le home) ──
    const contRaw = sessionStorage.getItem(CONTINUE_STORAGE_KEY);
    if (contRaw) {
      ideaConsumedRef.current = true;
      sessionStorage.removeItem(CONTINUE_STORAGE_KEY);
      try {
        const cfg = JSON.parse(contRaw) as ContinueConfig;
        // ── Écran propre : on repart de zéro ─────────────────────────────
        // Un build résiduel (projet zombie relancé par le self-heal serveur,
        // ou état laissé par une session précédente) laissait le store en
        // `isBuilding=true` → le guard de triggerBuild bloquait silencieusement
        // le nouveau build de clone (« ça ne commence même pas »). On efface
        // tout état de build et le verrou de déclenchement pour que le mode
        // « Continuer » démarre proprement et attende jusqu'à ce que ça parte.
        build.reset();
        buildTriggeredRef.current = false;
        continueFlowRef.current = true;
        // Filet de sécurité : si l'orchestrateur ne renvoie jamais
        // shouldBuild/cloneBuild (clone non détecté, erreur réseau…), on relâche
        // le verrou après 60s pour ne pas casser le rechargement/reprise durant
        // toute la session.
        setTimeout(() => { continueFlowRef.current = false; }, 60000);
        pendingNoPreviewRef.current = !needsPreview(cfg.specialists);
        setNoPreviewMode(pendingNoPreviewRef.current);
        // Mémorise l'équipe choisie → gating des demandes hors-spécialité + envoi backend.
        specialistsRef.current = Array.isArray(cfg.specialists) ? cfg.specialists.slice() : [];
        persistSpecialists();
        const contMsg = buildContinueMessage(cfg);
        // Mode « Continuer » : l'IA démarre seule. On envoie les instructions à
        // l'IA (côté serveur) mais SANS afficher le gros prompt comme bulle
        // utilisateur — ni maintenant, ni au rechargement (persisté en 'system').
        setTimeout(() => doSend(contMsg, undefined, { hidden: true }), 150);
      } catch {
        ideaConsumedRef.current = false;
      }
      return;
    }

    const idea = sessionStorage.getItem('velbaz_idea');
    if (!idea) return;
    ideaConsumedRef.current = true;
    sessionStorage.removeItem('velbaz_idea');
    // ── Commande /genesis tapée depuis la barre de prompt de la HOME ──────────
    // Le prompt transite par sessionStorage et arrivait tel quel dans doSend :
    // la commande n'était donc jamais interceptée (et « genesis » finissait pris
    // pour le nom de la marque). On la route ici vers le moteur, comme dans le chat.
    if (/^\/(genesis|vision)\b/i.test(idea.trim())) {
      sessionStorage.removeItem('velbaz_plan_mode');
      sessionStorage.removeItem('velbaz_attachments');
      setTimeout(() => runGenesisFlow(idea.trim()), 150);
      return;
    }
    // Plan mode flag passed from the home page prompt bar
    const planFlag = sessionStorage.getItem('velbaz_plan_mode') === '1';
    if (planFlag) {
      sessionStorage.removeItem('velbaz_plan_mode');
      setPlanMode(true);
      setTimeout(() => {
        setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', content: idea, time: new Date() }]);
        generatePlan(idea);
      }, 150);
      return;
    }
    // Check for attachments passed from home page
    const storedAttachments = sessionStorage.getItem('velbaz_attachments');
    let parsedAttachments: Attachment[] | undefined;
    if (storedAttachments) {
      sessionStorage.removeItem('velbaz_attachments');
      try {
        const parsed = JSON.parse(storedAttachments);
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsedAttachments = parsed;
        }
      } catch {}
    }
    setTimeout(() => doSend(idea, parsedAttachments), 150);
  }, []);

  const cancelRequest = useCallback(() => {
    if (isBuildingThis) {
      build.cancelBuild();
    } else {
      // Save partial AI response before cancelling
      const partial = streamingContentRef.current;
      if (partial?.trim()) {
        setMessages(prev => [...prev, { id: `a-partial-${Date.now()}`, role: 'assistant', content: partial.trim(), model: 'velbaz', time: new Date() }]);
      }
      if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
      setStreamingContent('');
      streamingContentRef.current = '';
      setChatLoading(false);
      sendingRef.current = false;
    }
  }, [isBuildingThis]);

  const buildTriggeredRef = useRef(false);
  // Projet pré-créé dès le tout premier message (avant toute intention de build).
  // triggerBuild le réutilise au lieu de recréer une company.
  const precreatedCompanyRef = useRef<{ id: string; name: string; industry?: string; idea?: string; country?: string } | null>(null);
  const precreatingRef = useRef(false);
  // Preview de marque AVANT le build : quand on s'apprête à créer une NOUVELLE
  // entreprise, on montre d'abord un pop-up (logo + palette + typo) que
  // l'utilisateur valide ou fait changer. Le build ne démarre qu'après validation.
  const [pendingBrandBuild, setPendingBrandBuild] = useState<{ companyId: string } | null>(null);
  const brandBuildRunRef = useRef<(() => void) | null>(null);
  const brandGateDoneRef = useRef(false);

  // RESTAURATION de la porte de marque après refresh / redémarrage serveur.
  // Sans ça, le pop-up disparaît et le build ne repart jamais → tout est bloqué.
  useEffect(() => {
    // Le composant de chat reste MONTÉ quand on passe d'une conversation à une
    // autre (route unifiée) : sans ce nettoyage, l'aperçu de marque ouvert dans
    // un projet restait affiché dans le chat suivant. On le ferme dès que le
    // projet courant ne correspond plus à celui du pop-up.
    setPendingBrandBuild(prev => {
      if (!prev) return prev;
      if (prev.companyId === projectId) return prev;
      brandBuildRunRef.current = null;
      return null;
    });
    if (!user || !projectId) return;
    if (hasExistingWebsite || brandGateDoneRef.current) return;
    let saved: any = null;
    try { const raw = localStorage.getItem(`velbaz_brand_gate_${projectId}`); if (raw) saved = JSON.parse(raw); } catch {}
    // On ne restaure QUE la porte enregistrée pour ce projet-ci.
    if (saved?.companyId && saved.companyId === projectId) {
      brandBuildRunRef.current = () => launchBuildForMsg(String(saved.msg || ''));
      setPendingBrandBuild({ companyId: saved.companyId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, projectId, hasExistingWebsite]);

  // Crée le projet dès le TOUT premier message (même "salut"): il apparaît
  // aussitôt dans la sidebar avec le nom en "chargement", et on navigue vers
  // /chat/:id pour que la conversation vive sous ce projet. Idempotent.
  async function ensureProjectForFirstMessage(firstMsg: string): Promise<string | null> {
    if (!user) return null;
    if (projectId) return projectId; // déjà dans un projet
    if (precreatedCompanyRef.current) return precreatedCompanyRef.current.id;
    if (precreatingRef.current) return null;
    precreatingRef.current = true;
    try {
      const res = await api.companies.quickCreate({ idea: firstMsg, deferName: true });
      if (!res.company) return null;
      const company = res.company;
      precreatedCompanyRef.current = company;
      addProjectWithNamePoll(company, !!res.nameReady);
      if (typeof res.tokenBalance === 'number') updateTokens(res.tokenBalance);
      // Rapatrie les messages de la session temporaire sous l'id du projet.
      try { if (stableSessionId !== company.id) await api.chat.migrate(stableSessionId, company.id); } catch {}
      // Navigue vers le projet — le composant reste monté (route unifiée).
      navigate(`/chat/${company.id}`);
      return company.id;
    } catch (e) {
      console.error('[ensureProject] pre-create failed:', e);
      return null;
    } finally {
      precreatingRef.current = false;
    }
  }

  async function triggerBuild(lastMsg: string, extraContext?: string, opts?: { clone?: boolean }) {
    // Prevent double-trigger (React StrictMode, stream retry, etc.)
    if (buildTriggeredRef.current) {
      console.log('[triggerBuild] Already triggered, skipping duplicate');
      return;
    }
    // Guard SCOPÉ à la company cible. Avant, `build.isBuilding` (peu importe
    // quelle company) bloquait le build → un projet zombie relancé par le
    // self-heal empêchait le clone/continue de démarrer. Désormais : on ne
    // saute que si c'est DÉJÀ cette company qui construit ; un build résiduel
    // d'une AUTRE company est superseded (annulé) au lieu de tout bloquer.
    const _targetBuildId = precreatedCompanyRef.current?.id || projectId || null;
    if (build.isBuilding && build.companyId && build.companyId === _targetBuildId) {
      console.log('[triggerBuild] Already building THIS company, skipping');
      return;
    }
    if (build.isBuilding && build.companyId && build.companyId !== _targetBuildId) {
      console.log('[triggerBuild] Superseding stale build of', build.companyId);
      build.cancelBuild();
    }
    buildTriggeredRef.current = true;
    console.log('[triggerBuild] Starting...', { hasUser: !!user, lastMsgLen: lastMsg.length });

    if (!user) {
      buildTriggeredRef.current = false;
      console.log('[triggerBuild] No user — showing sign-in prompt');
      setMessages(prev => [...prev, {
        id: `login-${Date.now()}`, role: 'assistant',
        content: 'Create a free account to launch your project! You\'ll receive **5000 free credits** to get started.\n\n→ [Create an account](/register)\n→ [Sign in](/login)',
        model: 'velbaz', time: new Date(),
      }]);
      return;
    }

    // Build full conversation context as the idea — includes all Q&A details
    const allMsgs = messages.filter(m => m.role === 'user' || m.role === 'assistant');
    let idea = lastMsg;
    if (allMsgs.length > 1) {
      const convoLines: string[] = [];
      for (const m of allMsgs) {
        const cleanContent = m.content.replace(/\[BUILD_COMPANY\]/g, '').trim();
        if (cleanContent) convoLines.push(`${m.role === 'user' ? 'User' : 'AI'}: ${cleanContent}`);
      }
      idea = convoLines.join('\n');
    }
    // Contexte supplémentaire (ex : plan validé par l'utilisateur) — toujours inclus
    // même quand idea est reconstruite depuis l'historique de conversation.
    if (extraContext && !idea.includes(extraContext)) {
      idea = `${idea}\n\n${extraContext}`;
    }

    let company: any = null;
    resetPrepSteps();
    prepStep('create', 'running');
    try {
      // Réutilise le projet DÉJÀ créé au 1er message si présent (pré-création),
      // sinon crée-le maintenant. Évite tout doublon dans l'historique.
      const existing = precreatedCompanyRef.current || (projectId ? { id: projectId } as any : null);
      if (existing?.id) {
        console.log('[triggerBuild] Reusing pre-created company', existing.id);
        // Affine le nom/industrie/pays avec l'idée complète de la conversation.
        try { await api.companies.refreshMeta(existing.id, idea); } catch {}
        const fresh = await api.companies.get(existing.id).catch(() => null);
        company = fresh?.company || existing;
        // S'assure qu'il est bien dans la sidebar (au cas où).
        addProjectWithNamePoll({ id: company.id, name: company.name || 'New Project' }, false);
      } else {
        console.log('[triggerBuild] Calling quickCreate...');
        const res = await api.companies.quickCreate({ idea });
        console.log('[triggerBuild] quickCreate response:', { company: !!res.company, error: res.error });
        if (!res.company) {
          // Check if it's a token/credit issue
          const isTokenError = res.error && (res.error.includes('Not enough tokens') || res.error.includes('token'));
          if (isTokenError) {
            // Save the idea so user can retry later with "continue" without re-answering questions
            sessionStorage.setItem('velbaz_build_pending', JSON.stringify({ idea, timestamp: Date.now() }));
            // Also save to DB so it survives page close
            try { await api.chat.save({ sessionId, role: 'system', content: `[BUILD_PENDING]${idea}[/BUILD_PENDING]` }); } catch {}
          }
          throw new Error(res.error || 'Failed');
        }
        company = res.company;
        console.log('[triggerBuild] Company created:', company.id, company.name);
        // Show the project in the sidebar IMMEDIATELY with a loading name.
        addProjectWithNamePoll(company, !!res.nameReady);
      }
    } catch (e: any) {
      console.error('[triggerBuild] quickCreate failed:', e);
      prepStep('create', 'error', e.message || 'failed');
      buildTriggeredRef.current = false;
      // Une création qui échoue ne doit pas laisser le flux « Continuer »
      // verrouillé (sinon le rechargement d'historique/reprise reste cassé
      // pour toute la session).
      continueFlowRef.current = false;
      const isTokenErr = e.message && (e.message.includes('Not enough tokens') || e.message.includes('token'));
      const errContent = isTokenErr
        ? `⚠️ Not enough credits to launch the project. Buy credits on the [Plans](/plans) page, then come back here and say **"continue"** — I'll start everything without asking the questions again.`
        : `Error creating the project: ${e.message}`;
      setMessages(prev => [...prev, { id: `err-${Date.now()}`, role: 'assistant', content: errContent, model: 'velbaz', time: new Date() }]);
      return;
    }

    // ── Clear BUILD_PENDING on successful build ──
    sessionStorage.removeItem('velbaz_build_pending');
    // Also remove from DB so it doesn't get re-detected on next load
    try {
      const historyRes: any = await api.chat.history(sessionId);
      const pendingMsgs = (historyRes.messages || []).filter((m: any) => m.role === 'system' && (m.content || '').includes('[BUILD_PENDING]'));
      for (const pm of pendingMsgs) {
        if (pm.id) fetch(`/api/chat/message/${pm.id}`, { method: 'DELETE' }).catch(() => {});
      }
    } catch {}

    const currentSessionId = sessionId;
    if (currentSessionId !== company.id) {
      // Await migration so messages exist under the new ID before navigation triggers history load
      try { await api.chat.migrate(currentSessionId, company.id); } catch {}
    }
    // Project was already added to the sidebar (with its loading state) right
    // after quickCreate — don't re-add here, that would clobber `loading`.

    // ── Browsing from /chat to /chat/:id ──
    // With the unified route (/chat/:id?), the component stays mounted on navigate.
    // The useEffect on projectId change will detect buildTriggeredRef.current and skip history reload,
    // preserving all existing messages and state.

    // ── Détection du type de projet : website, mobile app ou les deux ──
    // Regex 0 coût puis modèle rapide côté serveur. 'unknown' → on pose la
    // question (3 options) AVANT les previews de style / le questionnaire.
    prepStep('create', 'done', company?.name ? `"${company.name}"` : undefined);
    prepStep('detect', 'running');
    let detectedType: string = 'web';
    if (opts?.clone) {
      // ── Clonage / « Continuer une company » depuis une URL → TOUJOURS web ──
      // On reproduit un SITE WEB, jamais une mobile app. Sans ce garde, la
      // détection lisait le texte de l'idée (qui peut contenir « mobile app »,
      // « application », etc.) et partait sur startMobileBuildNow → l'IA
      // annonçait « création d'mobile app » alors qu'elle devait recréer le site.
      detectedType = 'web';
    } else {
      try {
        const dt = await api.companies.detectType(company.id);
        detectedType = dt?.projectType || 'web';
      } catch { detectedType = 'web'; }
    }
    prepStep('detect', 'done',
      detectedType === 'mobile' ? 'mobile app'
      : detectedType === 'both' ? 'website + mobile app'
      : detectedType === 'web' ? 'website'
      : "to be confirmed (I'll ask you)");

    if (detectedType === 'unknown') {
      navigate(`/chat/${company.id}`);
      setPendingTypeChoice({ company });
      setTimeout(() => { buildTriggeredRef.current = false; }, 5000);
      return; // attend confirmProjectType()
    }
    if (detectedType === 'mobile' || detectedType === 'both') {
      setProjectType(detectedType as 'mobile' | 'both');
      if (detectedType === 'mobile') {
        // App mobile SEULE : pas de previews de style ni de questionnaire de
        // pages (l'IA planifie les écrans) — build direct.
        navigate(`/chat/${company.id}`);
        startMobileBuildNow(company);
        return;
      }
      // 'both' : flux web normal (previews + questionnaire) — le build mobile
      // s'enchaîne côté serveur dans le même job.
    }

    // ── Plus de previews de thèmes/styles ──
    // On passe directement à la planification des pages puis au build.
    navigate(`/chat/${company.id}`);
    // Clone / « Continuer une company » : on NE propose PAS le questionnaire de
    // pages (on clone les pages réelles du site) — build direct, aucun pop-up.
    if (opts?.clone) {
      finalizePrepSteps();
      build.runBuild(company);
      // Le build tourne : runBuild possède désormais le polling → on libère le
      // flux « Continuer » pour que l'affichage/reprise redevienne normal.
      continueFlowRef.current = false;
      setTimeout(() => { buildTriggeredRef.current = false; }, 5000);
      return;
    }
    const shown = await planPagesAndShow(company);
    if (!shown) {
      // Planning failed/empty — build directly.
      finalizePrepSteps();
      build.runBuild(company);
    }
    setTimeout(() => { buildTriggeredRef.current = false; }, 5000);
  }

  // Generate 3 more mockup previews
  async function generateMorePreviews() {
    if (!pendingCompany || generatingMore) return;
    setGeneratingMore(true);
    try {
      const res = await api.templates.generatePreviews(pendingCompany.industry, pendingCompany.idea, pendingCompany.name);
      const newPreviews = res.previews || [];
      if (newPreviews.length > 0) {
        setPendingPreviews(newPreviews);
      }
    } catch (e) {
      console.error('[generateMorePreviews] Failed:', e);
    }
    setGeneratingMore(false);
  }

  // Called when user picks a style or clicks "Skip"
  // Instead of building immediately, we plan the pages first and show the
  // page-selection questionnaire. The actual build starts in confirmPages().
  async function confirmBuildWithStyle(styleName?: string, styleDescription?: string) {
    if (!pendingCompany) return;
    const company = pendingCompany;
    setPendingPreviews(null);
    setPendingCompany(null);

    const styleRef = styleName && styleDescription ? `${styleName}: ${styleDescription}` : undefined;

    if (styleRef) {
      setMessages(prev => [...prev, {
        id: `style-choice-${Date.now()}`, role: 'assistant',
        content: `Style **"${styleName}"** selected! I'm preparing the page plan...`,
        model: 'velbaz', time: new Date(), isBuildStep: true,
      }]);
    } else {
      setMessages(prev => [...prev, {
        id: `style-skip-${Date.now()}`, role: 'assistant',
        content: `Perfect — I'm preparing the page plan for your site...`,
        model: 'velbaz', time: new Date(), isBuildStep: true,
      }]);
    }

    // Plan the pages, then show the questionnaire.
    const shown = await planPagesAndShow(company, styleRef);
    if (!shown) {
      // Planning failed or empty — build directly (AI plans internally).
      startBuildNow(company, styleRef);
    }
  }

  // Plans the pages for a company and shows the selection questionnaire.
  // Returns true if the questionnaire was shown (build must wait for
  // confirmPages), false if planning failed/empty (caller should build now).
  async function planPagesAndShow(
    company: { id: string; name: string; industry?: string; idea?: string },
    styleRef?: string,
  ): Promise<boolean> {
    // "Crée une page blanche" = UNE page : on ne propose JAMAIS un plan de
    // pages ni un questionnaire de sélection — on construit directement la page.
    const ideaTxt = (company.idea || '').toLowerCase();
    const singlePage = /\b(page|site|landing)\b[\s\S]{0,25}?\b(blanche?|vide|vierge|blank|empty)\b/.test(ideaTxt)
      || /\b(blank|empty)\s+(page|site|landing)\b/.test(ideaTxt)
      || /\b(une|1)\s+(seule\s+)?page\b/.test(ideaTxt)
      || /\b(single|one)\s+page\b/.test(ideaTxt);
    if (singlePage) return false; // caller → startBuildNow (build direct, 1 page)

    setPlanningPages(true);
    prepStep('plan', 'running', 'web search + analysis of your request (30-60 s)');
    try {
      const res: any = await api.companies.planPages(company.id, company.idea);
      const allPages: any[] = res?.pages || [];
      // Standard pages (login, settings, terms, privacy, support, 404) are added
      // automatically and never shown in the questionnaire. Every other
      // functional page is shown, checked by default, so the user can uncheck
      // the ones they don't want and add custom ones.
      const STD = /^(login|log ?in|sign ?in|sign ?up|register|auth|settings|r[ée]glages|param[èe]tres|account|compte|profile|profil|terms|conditions|mentions|privacy|confidentialit|support|help|aide|contact|404|not ?found|error)/i;
      const isStandard = (p: any) => STD.test(String(p?.name || '')) || STD.test(String(p?.route || '').replace(/^\//, ''));
      const shown: any[] = allPages.filter((p: any) => !isStandard(p));
      const autoPages: any[] = allPages.filter((p: any) => isStandard(p));
      if (shown.length > 0) {
        prepStep('plan', 'done', `${allPages.length} pages planned — ready for your review`);
        setPendingPagePlan({ company, styleRef, pages: shown, corePages: autoPages } as any);
        setCheckedPages(shown.map(() => true));
        setCustomPages([]);
        setPlanningPages(false);
        return true; // wait for confirmPages()
      }
      prepStep('plan', 'done', 'internal plan — building directly');
    } catch (e) {
      console.error('[planPagesAndShow] planPages failed:', e);
      prepStep('plan', 'error', 'plan failed — building directly');
    }
    setPlanningPages(false);
    return false;
  }

  // Lance le build d'une mobile app SEULE : pas de previews de style ni de
  // questionnaire de pages — l'IA planifie les écrans. Preview → téléphone.
  function startMobileBuildNow(company: { id: string; name: string; industry?: string; idea?: string }) {
    setProjectType('mobile');
    setPreviewDevice('phone');
    setMessages(prev => [...prev, {
      id: `build-start-${Date.now()}`, role: 'assistant',
      content: `📱 Building your mobile app... You'll be able to test it on your phone with a QR code. 🚀`,
      model: 'velbaz', time: new Date(), isBuildStep: true,
    }]);
    finalizePrepSteps();
    build.runBuild(company as any);
    setTimeout(() => { buildTriggeredRef.current = false; }, 5000);
  }

  // Réponse à la question « website, mobile app ou les deux ? » (idée ambiguë).
  async function confirmProjectType(answer: string) {
    if (!pendingTypeChoice) return;
    const company = pendingTypeChoice.company;
    setPendingTypeChoice(null);
    const a = (answer || '').toLowerCase();
    const chosen: 'web' | 'mobile' | 'both' =
      a.includes('deux') || a.includes('both') ? 'both'
      : a.includes('mobile') ? 'mobile'
      : 'web';
    setProjectType(chosen);
    try { await api.companies.setProjectType(company.id, chosen); } catch (e) { console.error('[confirmProjectType] save failed:', e); }

    if (chosen === 'mobile') {
      startMobileBuildNow(company);
      return;
    }
    // web / both → planification directe des pages (plus de previews de style).
    const shown = await planPagesAndShow(company);
    if (!shown) { finalizePrepSteps(); build.runBuild(company as any); }
    setTimeout(() => { buildTriggeredRef.current = false; }, 5000);
  }

  // Starts the real build (used after page selection or as a fallback).
  function startBuildNow(company: { id: string; name: string; industry?: string; idea?: string }, styleRef?: string) {
    setMessages(prev => [...prev, {
      id: `build-start-${Date.now()}`, role: 'assistant',
      content: `Building your site... 🚀`,
      model: 'velbaz', time: new Date(), isBuildStep: true,
    }]);
    finalizePrepSteps();
    build.runBuild(company as any, styleRef);
    setTimeout(() => { buildTriggeredRef.current = false; }, 5000);
  }

  // Called when the user confirms their page selection in the questionnaire.
  // `answer` is the comma-joined list of chosen page labels returned by the
  // QuestionTool (existing pages by name + any custom pages typed by the user).
  async function confirmPages(answer: string) {
    if (!pendingPagePlan) return;
    const { company, styleRef, pages, corePages } = pendingPagePlan;

    const tokens = String(answer || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    // Match each selected token against a proposed page (by name). Tokens that
    // don't match any proposed page are treated as custom pages the user added.
    const norm = (s: string) => s.toLowerCase().trim();
    const kept: any[] = [];
    const customs: any[] = [];
    for (const tok of tokens) {
      const match = pages.find(p => norm(String(p.name)) === norm(tok));
      if (match) kept.push(match);
      else customs.push({ name: tok, purpose: '', custom: true });
    }
    const chosen = [...(corePages || []), ...kept, ...customs];

    setPendingPagePlan(null);
    setCheckedPages([]);
    setCustomPages([]);

    try {
      await api.companies.selectPages(company.id, chosen);
    } catch (e) {
      console.error('[confirmPages] selectPages failed:', e);
    }
    startBuildNow(company, styleRef);
  }

  // Called by the PagePlanTool with the full list of pages the user wants
  // (name + purpose, already edited/added/deleted). Preserves purposes and
  // any edits, then launches the build.
  async function confirmPagesList(chosenPages: { name: string; purpose?: string }[]) {
    if (!pendingPagePlan) return;
    const { company, styleRef, corePages } = pendingPagePlan;

    const cleaned = (chosenPages || [])
      .map(p => ({ name: String(p.name || '').trim(), purpose: p.purpose ? String(p.purpose).trim() : '' }))
      .filter(p => p.name.length > 0)
      .map(p => ({ ...p, custom: true }));

    const chosen = [...(corePages || []), ...cleaned];

    setPendingPagePlan(null);
    setCheckedPages([]);
    setCustomPages([]);

    try {
      await api.companies.selectPages(company.id, chosen);
    } catch (e) {
      console.error('[confirmPagesList] selectPages failed:', e);
    }
    startBuildNow(company, styleRef);
  }

  // Called when the user clicks "Passer — l'IA décide" in the questionnaire.
  // Clears any stored page selection so the AI plans the pages itself, then
  // launches the build.
  async function skipPageSelection() {
    if (!pendingPagePlan) return;
    const { company, styleRef } = pendingPagePlan;
    setPendingPagePlan(null);
    setCheckedPages([]);
    setCustomPages([]);
    // Clear selection → AI decides the pages the business needs.
    try {
      await api.companies.selectPages(company.id, []);
    } catch (e) {
      console.error('[skipPageSelection] selectPages clear failed:', e);
    }
    startBuildNow(company, styleRef);
  }

  // ── File attachment helpers ──────────────────────────────────────────
  async function processFile(file: File): Promise<Attachment | null> {
    const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
    if (file.size > MAX_SIZE) { alert(`File "${file.name}" is too large (max 10 MB).`); return null; }

    const mimeType = file.type || 'application/octet-stream';
    let type: 'image' | 'document' | 'text' = 'document';
    if (mimeType.startsWith('image/')) type = 'image';
    else if (mimeType === 'application/pdf') type = 'document';
    else if (mimeType.startsWith('text/') || /\.(txt|md|csv|json|js|ts|jsx|tsx|py|html|css|yml|yaml|xml|sh|rb|go|java|c|cpp|rs)$/i.test(file.name)) type = 'text';

    return new Promise<Attachment | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = e.target?.result as string;
        const att: Attachment = {
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          mimeType,
          data,
          size: file.size,
          type,
          previewUrl: type === 'image' ? data : undefined,
        };
        resolve(att);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  const lastDropTime = useRef(0);
  async function handleFilesSelected(files: FileList | File[]) {
    // Debounce to prevent double-add from overlapping events
    const now = Date.now();
    if (now - lastDropTime.current < 300) return;
    lastDropTime.current = now;
    const arr = Array.from(files);
    const processed = await Promise.all(arr.map(processFile));
    const valid = processed.filter(Boolean) as Attachment[];
    setAttachments(prev => [...prev, ...valid]);
  }

  function removeAttachment(id: string) {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) {
      handleFilesSelected(e.target.files);
      e.target.value = '';
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems = Array.from(items).filter(i => i.kind === 'file' && i.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    const files = imageItems.map(i => i.getAsFile()).filter(Boolean) as File[];
    handleFilesSelected(files);
  }

  // ── Prevent browser default file drop (opens file) ──
  useEffect(() => {
    const prevent = (e: DragEvent) => { e.preventDefault(); };
    document.addEventListener('dragover', prevent);
    document.addEventListener('drop', prevent);
    return () => { document.removeEventListener('dragover', prevent); document.removeEventListener('drop', prevent); };
  }, []);
  // ── End file helpers ─────────────────────────────────────────────────

  const sendingRef = useRef(false);

  // ── Detect if a message is a site-edit instruction vs normal chat ──
  function isSiteEditInstruction(msg: string): boolean {
    const lower = msg.toLowerCase().trim();
    // Explicit edit patterns (EN + FR)
    const editPatterns = [
      /\b(change|modify|update|edit|replace|remove|delete|add|move|make|set|put|insert|swap|switch|hide|show|resize|enlarge|shrink|center|align|bold|italic|underline)\b.*(color|text|button|section|image|logo|font|size|background|header|footer|nav|link|title|heading|paragraph|border|padding|margin|style|page|element|icon|menu|card|banner|hero|form|input|placeholder|width|height|opacity|shadow|gradient|animation|position|layout|grid|flex|photo|picture|video|carousel|slider|testimonial|price|feature|cta|call.to.action)/i,
      /\b(couleur|texte|bouton|section|image|fond|police|taille|titre|lien|menu|carte|bannière|formulaire|ajoute|supprime|modifie|change|remplace|déplace|mets|agrandis|réduis|centre|aligne|gras|italique|cache|montre|insère|passe|violet|mauve|rouge|bleu|vert|jaune|orange|noir|blanc|rose|gris|sombre|clair)\b/i,
      /\b(make|rend[s]?)\s+(it|the|this|le|la|les)\b/i,
      /\b(je\s+veux|I\s+want)\b.*(page|site|couleur|color|design|style|mauve|violet|rouge|bleu|vert|theme|thème)/i,
      /\b(passe|rends?|transforme)\s.*(en|au|à)\s/i,
      /\b(when|quand)\s+(i|je|on)\s+(click|clique|tap|press|appuie)/i,
      /\b(navigate|redirect|go\s+to|link\s+to|ouvre|redirige|navigue)\b/i,
      /\b(on\s+the\s+(home|about|contact|services?|pricing|blog)\s*page)\b/i,
      /\b(sur\s+la\s+page)\b/i,
      /\b(homepage|header|footer|navbar|sidebar|hero\s*section)\b/i,
      /\b(bigger|smaller|larger|wider|taller|shorter|thicker|thinner|brighter|darker|lighter)\b/i,
      /\b(plus\s+(grand|petit|gros|large|sombre|clair|épais|fin))\b/i,
      /^(add|remove|change|update|create|delete|move|insert|make|set)\s/i,
      /^(ajoute|supprime|change|modifie|crée|déplace|insère|mets)\s/i,
      /#[0-9a-fA-F]{3,8}\b/, // hex color
      /\b(rgb|rgba|hsl)\s*\(/i, // css color functions
      /\b(\d+px|\d+rem|\d+em|\d+%)\b/, // css units
    ];
    return editPatterns.some(p => p.test(lower));
  }

  // Lance réellement la construction pour un message donné. Extrait pour que la
  // porte de marque (pop-up) puisse être RESTAURÉE après un refresh / redémarrage
  // serveur et relancer le build sans rien perdre.
  function launchBuildForMsg(msg: string, opts?: { clone?: boolean }) {
    const alreadyPlanned = msg.includes("[PLAN APPROVED BY USER") || msg.includes("[PLAN VALIDÉ PAR L'UTILISATEUR");
    // Ordre EXPLICITE de démarrer (« commence », « continue », « vas-y »…).
    const GO_ORDER_RE = /^\s*(ok(ay)?|oui|ouais|yes|alors|bon|allez|stp|svp|please|et|donc)?\s*(comm?[ea]n[cs]{1,2}e[srz]?|continu(e[srz]?|er|ez)?|reprend([sz]|re)?|poursui[st]?|go+|lance(s|r|z)?([- ]toi)?|vas[- ]?y|fonce[rz]?|c'?est parti|c'?est bon|d[ée]marre[rz]?|start|resume|build( it)?|ship it|do it|let'?s go)\s*(maintenant|now|stp|svp|please|tout de suite)?\s*[!.…]*\s*$/i;
    const explicitGo = GO_ORDER_RE.test(msg);
    // Clone / « Continuer une company » : build DIRECT — pas de plan à valider,
    // pas de questionnaire de pages, pas de pop-up. On reconstruit fidèlement le
    // site cloné tout de suite.
    if (opts?.clone) {
      if (user) {
        setMessages(prev => [...prev, { id: `build-start-${Date.now()}`, role: 'assistant', content: '🚀 Creating your project...', model: 'velbaz', time: new Date() }]);
      }
      setChatLoading(true);
      triggerBuild(msg, undefined, { clone: true }).finally(() => setChatLoading(false));
      return;
    }
    if (user && !alreadyPlanned && !explicitGo && planMode) {
      setMessages(prev => [...prev, { id: `plan-pre-${Date.now()}`, role: 'assistant', content: "📋 Before we start, I'm preparing a complete plan for your project. Validate it and I'll start building.", model: 'velbaz', time: new Date() }]);
      setPlanForBuild(true);
      generatePlan(msg).then(ok => {
        if (!ok) {
          setPlanForBuild(false);
          setMessages(prev => [...prev, { id: `plan-fb-${Date.now()}`, role: 'assistant', content: 'The plan could not be generated — I\'ll start building directly.', model: 'velbaz', time: new Date() }]);
          setChatLoading(true);
          triggerBuild(msg).finally(() => setChatLoading(false));
        }
      });
    } else {
      if (user) {
        setMessages(prev => [...prev, { id: `build-start-${Date.now()}`, role: 'assistant', content: '🚀 Creating your project...', model: 'velbaz', time: new Date() }]);
      }
      setChatLoading(true);
      triggerBuild(msg).finally(() => setChatLoading(false));
    }
  }

  async function doSend(msg: string, overrideAttachments?: Attachment[], opts?: { hidden?: boolean; appendContext?: string }) {
    const hidden = opts?.hidden === true;
    // Filet de sécurité : si un « /genesis » ou « /vision » traîne encore en tête
    // du message (chemin d'entrée oublié), on le retire avant l'envoi. Sinon
    // l'orchestrateur lit « genesis » comme faisant partie de l'idée et baptise
    // la marque « Genesis … ».
    msg = msg.replace(/^\/(genesis|vision)\b[\s:]*/i, '');
    const effectiveAttachments = overrideAttachments ?? attachments;
    if ((!msg.trim() && effectiveAttachments.length === 0) || chatLoading || isBuildingThis) return;
    // Prevent concurrent sends (React StrictMode double-mount)
    if (sendingRef.current) return;
    sendingRef.current = true;

    if (!user) {
      setShowAuthModal(true);
      sendingRef.current = false;
      return;
    }

    // ── Approbation LOGIQUE d'un plan / d'une pop-up en attente ──────────────────
    // Si l'IA attend une validation (plan affiché ou pop-up de confirmation) et que
    // l'utilisateur répond simplement « ok / vas-y / travaille / valide / continue »,
    // on l'interprète comme une VALIDATION de ce qui est en attente — pas comme un
    // nouveau message ignoré. (On ignore les envois cachés/programmés.)
    const AFFIRM_RE = /^\s*(ok(ay)?|oui|ouais|ouai|yes|yep|yup|d'?accord|dacc?ord?|parfait|super|nickel|impec|c'?est bon|c'?est parfait|c'?est parti|vas[- ]?y|allez|go+|lance([- ]?toi)?|commence[rz]?|continue[rz]?|travaille[rz]?|au boulot|fais[- ]?le|fonce[rz]?|valide[rz]?|je valide|approuve[rz]?|proc[èe]de[rz]?|on y va|do it|let'?s go|start|build( it)?|ship it)[\s!.…]*$/i;
    if (!hidden && msg.trim() && AFFIRM_RE.test(msg.trim())) {
      // 1) Un PLAN est affiché → on le valide directement
      if (planData) {
        setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', content: msg, time: new Date() }]);
        setInput('');
        sendingRef.current = false;
        validatePlan();
        return;
      }
      // 2) Une POP-UP de confirmation / récap / aperçu est ouverte → réponse affirmative
      if (pendingPopup && isBlockingPopup(pendingPopup.type)
          && (pendingPopup.type === 'confirm' || pendingPopup.type === 'alert' || pendingPopup.type === 'recap' || pendingPopup.type === 'preview')) {
        const p = pendingPopup;
        let affirm: string;
        if (p.type === 'recap') affirm = `[RECAP VALIDATED] All good, proceed.`;
        else if (p.type === 'preview') affirm = `[PREVIEW VALIDATED] Perfect, continue.`;
        else affirm = `[CONFIRMED] ${p.title || p.message || ''}`;
        setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', content: msg, time: new Date() }]);
        setInput('');
        setPendingPopup(null);
        sendingRef.current = false;
        setTimeout(() => doSend(affirm), 50);
        return;
      }
    }

    // ── Pending build retry: if a previous build failed due to insufficient tokens ──
    const pendingRaw = sessionStorage.getItem('velbaz_build_pending');
    if (pendingRaw && !hasExistingWebsite) {
      try {
        const pending = JSON.parse(pendingRaw);
        if (pending.idea) {
          // User is back — show their message, clear pending, and retry the build
          setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', content: msg, time: new Date() }]);
          setInput('');
          sessionStorage.removeItem('velbaz_build_pending');
          sendingRef.current = false;
          triggerBuild(pending.idea);
          return;
        }
      } catch {}
    }

    // ── Label "I'm editing your app" : PILOTÉ PAR LE SERVEUR ──
    // Avant, ce label était deviné côté client via une regex (isSiteEditInstruction)
    // DIFFÉRENTE du classifieur serveur (isAppEditRequest). Résultat : le label
    // promettait une modification alors que le serveur, lui, décidait "CHAT" et
    // ne modifiait rien → "sa met tout le temps I'm editing your app mais l'app
    // ne change pas". Désormais on part de FALSE et le serveur envoie un
    // événement {editing:true} UNIQUEMENT quand une vraie édition démarre.
    // (On remet aussi à zéro l'état resté collé du message précédent.)
    setSiteEditLoading(false);

    const currentAttachments = [...effectiveAttachments];
    const displayMsg = msg || (currentAttachments.length > 0 ? `[${currentAttachments.length} file(s)]` : '');
    const msgAttachments = currentAttachments.length > 0
      ? currentAttachments.map(a => ({ name: a.name, type: a.type, previewUrl: a.type === 'image' ? a.data : undefined }))
      : undefined;

    // L'utilisateur envoie un message : on se recolle en bas pour cette réponse.
    stickToBottomRef.current = true;
    // En mode caché (« Continuer une company »), on n'affiche PAS de bulle
    // utilisateur : l'IA démarre seule. Le message est quand même envoyé au
    // serveur/IA plus bas.
    if (!hidden) {
      setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', content: displayMsg, time: new Date(), attachments: msgAttachments }]);
    }
    setChatLoading(true);
    setInput('');
    setAttachments([]);
    setStreamingContent('');
    setStreamingModel('google/gemini-3-flash');
    // Réinitialise les étapes de travail live pour ce nouvel envoi.
    liveProgressRef.current = [];
    setLiveProgress([]);
    liveCameraShotRef.current = null;
    setLiveCamera(null);

    // ── Créer le projet dès le TOUT premier message ──
    // Si l'utilisateur n'est dans aucun projet, on crée la company maintenant:
    // elle apparaît immédiatement dans la sidebar (nom en "chargement") et la
    // conversation continue sous /chat/:id. Le nom se précise ensuite.
    let effectiveId = projectId;
    if (user && !projectId && !precreatedCompanyRef.current) {
      const createdId = await ensureProjectForFirstMessage(msg || displayMsg);
      if (createdId) effectiveId = createdId;
    } else if (precreatedCompanyRef.current) {
      effectiveId = precreatedCompanyRef.current.id;
    }
    const effectiveSessionId = effectiveId || sessionId;

    const controller = new AbortController();
    abortRef.current = controller;

    let didFinish = false;

    // ── Watchdog client : filet de sécurité. Le serveur envoie un heartbeat
    // toutes les 10s ; si plus AUCUN octet n'arrive pendant 45s, la connexion est
    // morte (proxy/réseau) → on coupe pour ne JAMAIS laisser l'utilisateur bloqué
    // sur le loader « Structuring the response ». `lastActivity` est rafraîchi
    // à chaque lecture du flux (tokens ET pings).
    let lastActivity = Date.now();
    let watchdogFired = false;
    const watchdog = window.setInterval(() => {
      if (didFinish) { window.clearInterval(watchdog); return; }
      if (Date.now() - lastActivity > 90_000) {
        window.clearInterval(watchdog);
        watchdogFired = true;
        try { controller.abort(); } catch {}
      }
    }, 5_000);

    // Strip data from attachments for display but keep for sending
    const attachmentsPayload = currentAttachments.map(a => ({
      name: a.name,
      mimeType: a.mimeType,
      data: a.data,
      type: a.type,
      size: a.size,
    }));

    try {
      const token = localStorage.getItem('velbaz_token');
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ message: (msg || displayMsg) + (opts?.appendContext || ''), sessionId: effectiveSessionId, model: 'google/gemini-3-flash', tier: modelTier, companyId: effectiveId, attachments: attachmentsPayload.length > 0 ? attachmentsPayload : undefined, targetPlatform: previewDevice === 'phone' ? 'mobile' : 'web', hidden, enabledSpecialists: specialistsRef.current }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error('Stream failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      let finalModel = 'google/gemini-3-flash';
      let shouldBuild = false;
      let shouldContinue = false;
      // Questions envoyées par le serveur en JSON structuré (indépendant du
      // parsing du bloc [QUESTIONS] dans le texte) : garantit que le formulaire
      // s'affiche TOUJOURS quand l'IA annonce des questions.
      let streamQuestions: any[] | null = null;
      // Build issu d'un CLONE / « Continuer une company » : on lance la
      // construction DIRECTEMENT, sans l'aperçu de marque (marque reprise du site
      // cloné). Sans ça, le pop-up de marque restait ouvert → « rien ne se passe ».
      let cloneBuild = false;

      reading: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lastActivity = Date.now();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const data = JSON.parse(jsonStr);
            if (data.done) {
              shouldBuild = data.shouldBuild || false;
              if (Array.isArray(data.questions) && data.questions.length > 0) streamQuestions = data.questions;
              shouldContinue = data.shouldContinue || false;
              cloneBuild = data.cloneBuild || false;
              finalModel = data.model || finalModel;
              // Real-time token balance sync
              if (typeof data.tokenBalance === 'number') updateTokens(data.tokenBalance);
              // An app edit finished: bake the live task cards into the message
              // list so they persist as collapsed history, then clear live steps.
              // Une plateforme vient d'être ajoutée depuis le chat (web ⟷ mobile) :
              // le projet devient 'both' et on bascule la preview sur la nouvelle plateforme.
              if (data.platformAdded) {
                setProjectType('both');
                setPreviewDevice(data.platformAdded === 'mobile' ? 'phone' : 'web');
              }
              if (data.appEdited) {
                if (editStepsRef.current.length > 0) {
                  const baked = editStepsRef.current;
                  setMessages(prev => {
                    const have = new Set(prev.map(m => m.id));
                    return [...prev, ...baked.filter(s => !have.has(s.id))].sort((a, b) => a.time.getTime() - b.time.getTime());
                  });
                  editStepsRef.current = [];
                  setEditSteps([]);
                }
                // Le serveur de preview vient d'être redémarré (HMR coupé) : on
                // FORCE toujours le rechargement de l'iframe, qu'il y ait eu des
                // étapes affichées ou non. Sans ça, l'utilisateur devait
                // actualiser la page manuellement pour voir le résultat.
                setPreviewRefreshKey(k => k + 1);
              }
              break reading;
            }
            // Le serveur confirme qu'une VRAIE édition démarre → on affiche
            // le label "I'm editing your app/site" (source de vérité serveur).
            if (data.editing) {
              setSiteEditLoading(true);
              continue;
            }
            // ── Étape de travail réelle de l'IA (progress) ──
            // Chaque nouvelle étape devient l'étape « en cours » ; les
            // précédentes basculent en « terminé » côté rendu. Dédupliqué par id.
            if (data.progress && data.progress.label) {
              const prev = data.progress.preview as ProgressPreview | undefined;
              const step: ProgressItem = { id: String(data.progress.id || data.progress.label), label: String(data.progress.label), preview: prev };
              if (!liveProgressRef.current.some(s => s.id === step.id)) {
                const next = [...liveProgressRef.current, step];
                liveProgressRef.current = next;
                setLiveProgress(next);
              }
              // ── Caméra live : on met à jour l'aperçu courant. Une vraie capture
              // (screenshot) est mémorisée et reste affichée même quand l'action
              // suivante n'a pas d'image, avec l'action en cours en surimpression.
              if (prev) {
                if (prev.kind === 'screenshot' && prev.imageUrl) liveCameraShotRef.current = prev.imageUrl;
                setLiveCamera({ ...prev, imageUrl: prev.imageUrl || liveCameraShotRef.current || undefined });
              }
              continue;
            }
            if (data.buildStep) {
              // In-project app edit: render each step as a live task card.
              const bs = data.buildStep;
              const stepMsg: Message = {
                id: `activity-${bs.id}`,
                role: 'assistant',
                content: bs.content,
                model: 'velbaz',
                time: new Date(),
                isBuildStep: true,
                reasoning: bs.action === 'completed' ? 'Engineering Agent — done' : 'Engineering Agent is working on this...',
              } as Message;
              const next = [...editStepsRef.current.filter(s => s.id !== stepMsg.id), stepMsg];
              editStepsRef.current = next;
              setEditSteps(next);
              continue;
            }
            if (data.token !== undefined) {
              accumulated += data.token;
              // Le contenu réel commence à arriver → les étapes de travail ont
              // rempli leur rôle, on les retire (l'indicateur laisse place au texte).
              if (liveProgressRef.current.length > 0) {
                liveProgressRef.current = [];
                setLiveProgress([]);
                liveCameraShotRef.current = null;
                setLiveCamera(null);
              }
              // Strip [QUESTIONS]...[/QUESTIONS] and [BUILD_COMPANY] from display during streaming
              let displayText = accumulated.replace(/\[BUILD_COMPANY\]/g, '');
              // Strip complete [QUESTIONS]...[/QUESTIONS] or partial [QUESTIONS]... (no closing tag yet)
              displayText = displayText.replace(/\[QUESTIONS\][\s\S]*\[\/QUESTIONS\]/g, '');
              displayText = displayText.replace(/\[QUESTIONS\][\s\S]*$/g, '');
              // Strip [POPUP]...[/POPUP] (complete or still-streaming) from display
              displayText = displayText.replace(/\[POPUP\][\s\S]*\[\/POPUP\]/g, '');
              displayText = displayText.replace(/\[POPUP\][\s\S]*$/g, '');
              // Strip hidden [PLAN_DATA] marker (phased-plan persistence) from display
              displayText = displayText.replace(/\[PLAN_DATA\][\s\S]*\[\/PLAN_DATA\]/g, '');
              displayText = displayText.replace(/\[PLAN_DATA\][\s\S]*$/g, '');
              displayText = displayText.trim();
              setStreamingContent(displayText);
              streamingContentRef.current = displayText;
              setStreamingModel(finalModel);
            }
          } catch {}
        }
      }
      reader.cancel().catch(() => {});

      const finalContent = accumulated.replace(/\[BUILD_COMPANY\]/g, '').trim();
      setStreamingContent('');
      streamingContentRef.current = '';

      // ── Conversation d'équipe terminée : on la fige dans l'historique du chat ──
      if (liveTeamMsgsRef.current.length > 0) {
        const bakedTeam = liveTeamMsgsRef.current;
        liveTeamMsgsRef.current = [];
        setLiveTeamMsgs([]);
        setMessages(prev => [...prev, { id: `team-${Date.now()}`, role: 'assistant', content: '', teamMsgs: bakedTeam, model: 'velbaz', time: new Date() } as Message]);
      }

      // ── Parse [POPUP]...[/POPUP] from AI response (AI-triggered popups) ──
      const popupResult = extractPopup(finalContent);
      if (popupResult) {
        if (popupResult.rest) {
          setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: popupResult.rest, model: finalModel, time: new Date() }]);
        }
        setPendingPopup(popupResult.popup);
        didFinish = true;
        setChatLoading(false);
        abortRef.current = null;
        return;
      }

      // ── Parse [QUESTIONS]...[/QUESTIONS] from AI response ──
      // Use greedy match for content between tags since JSON may contain nested brackets
      const qMatch = finalContent.match(/\[QUESTIONS\]([\s\S]*)\[\/QUESTIONS\]/) 
        || finalContent.match(/\[QUESTIONS\]([\s\S]*$)/);
      
      let questionsParsed = false;
      if (qMatch) {
        const introText = finalContent
          .replace(/\[QUESTIONS\][\s\S]*\[\/QUESTIONS\]/g, '')
          .replace(/\[QUESTIONS\][\s\S]*$/g, '')
          .trim();
        if (introText) {
          setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: introText, model: finalModel, time: new Date() }]);
        }
        try {
          let jsonStr = qMatch[1].replace(/\[\/QUESTIONS\].*$/, '').trim();
          // Find the outermost JSON array — match from first [ to last ]
          const firstBracket = jsonStr.indexOf('[');
          const lastBracket = jsonStr.lastIndexOf(']');
          if (firstBracket !== -1 && lastBracket > firstBracket) {
            jsonStr = jsonStr.substring(firstBracket, lastBracket + 1);
          }
          let parsed: any;
          try {
            parsed = JSON.parse(jsonStr);
          } catch {
            // JSON might be truncated — try to repair
            let repaired = jsonStr;
            const quoteCount = (repaired.match(/"/g) || []).length;
            if (quoteCount % 2 !== 0) repaired += '"';
            // Count open/close braces
            const openBraces = (repaired.match(/\{/g) || []).length;
            const closeBraces = (repaired.match(/\}/g) || []).length;
            for (let i = 0; i < openBraces - closeBraces; i++) repaired += '}';
            const openBrackets = (repaired.match(/\[/g) || []).length;
            const closeBrackets = (repaired.match(/\]/g) || []).length;
            for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += ']';
            try { parsed = JSON.parse(repaired); } catch { parsed = null; }
          }
          if (Array.isArray(parsed) && parsed.length > 0) {
            const validQs = parsed.filter((q: any) => q && typeof q.q === 'string' && q.q.length > 2);
            if (validQs.length > 0) {
              console.log('[Velbaz] Parsed questions:', validQs.length, 'questions with options:', validQs.filter((q: any) => q.options?.length).length);
              setPendingQuestions(validQs);
              setQuestionIndex(0);
              setQuestionAnswers({});
              questionsParsed = true;
            }
          }
        } catch (e) {
          console.warn('[Velbaz] Failed to parse questions JSON:', e);
        }
      }
      
      // Filet : le texte n'a pas donné de formulaire mais le serveur a bien
      // renvoyé des questions structurées → on les affiche quand même.
      if (!questionsParsed && streamQuestions) {
        const validQs = streamQuestions.filter((q: any) => q && typeof q.q === 'string' && q.q.length > 2);
        if (validQs.length > 0) {
          const introText = finalContent
            .replace(/\[QUESTIONS\][\s\S]*\[\/QUESTIONS\]/g, '')
            .replace(/\[QUESTIONS\][\s\S]*$/g, '')
            .replace(/\[\/QUESTIONS\]/g, '')
            .replace(/\[BUILD_COMPANY\]/g, '')
            .trim();
          if (introText) {
            setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: introText, model: finalModel, time: new Date() }]);
          }
          setPendingQuestions(validQs);
          setQuestionIndex(0);
          setQuestionAnswers({});
          questionsParsed = true;
        }
      }

      if (!questionsParsed) {
        // Always strip any [QUESTIONS] tags from displayed content
        const cleaned = finalContent
          .replace(/\[QUESTIONS\][\s\S]*\[\/QUESTIONS\]/g, '')
          .replace(/\[QUESTIONS\][\s\S]*$/g, '')
          .replace(/\[\/QUESTIONS\]/g, '')
          .replace(/\[BUILD_COMPANY\]/g, '')
          .trim();
        if (cleaned) {
          setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: cleaned, model: finalModel, time: new Date() }]);
        }
      }

      didFinish = true;
      setChatLoading(false);
      setSiteEditLoading(false);
      abortRef.current = null;

      // NOTE: the backend AI intent classifier is the single source of truth for
      // whether a build should start. We deliberately do NOT re-detect "launch
      // intent" from the reply text here — that old heuristic misfired (e.g. the
      // greeting "je crée des entreprises…" wrongly triggered a company creation
      // on a plain "salut"). Trust shouldBuild from the stream.

      console.log(`[chat] Stream finished: shouldBuild=${shouldBuild}, shouldContinue=${shouldContinue}, accumulated=${accumulated.length} chars`);
      if (shouldBuild) {
        console.log('[chat] Calling triggerBuild... user=', user?.email || 'NOT LOGGED IN');
        // ── Gate "aperçu de marque" ──────────────────────────────────────
        // Avant de construire une NOUVELLE entreprise, on montre d'abord un
        // pop-up avec la marque proposée (logo + palette + typo). Le build ne
        // démarre qu'après « Valider ». Ne s'applique pas aux projets déjà
        // construits (édition) ni si la marque a déjà été validée ce tour-ci.
        const launchBuild = () => launchBuildForMsg(msg, { clone: cloneBuild });

        const gateCompanyId = precreatedCompanyRef.current?.id || projectId || null;
        // Clone / « Continuer une company » : on saute l'aperçu de marque et on
        // construit tout de suite (la marque vient du site cloné). Le pop-up de
        // marque bloquait sinon la construction (« rien ne se passe »).
        if (user && gateCompanyId && !hasExistingWebsite && !brandGateDoneRef.current && !cloneBuild) {
          // Montre l'aperçu de marque ; le build démarre après « Valider ».
          // PERSISTÉ : si le serveur redémarre ou l'utilisateur actualise, on
          // pourra restaurer le pop-up ET relancer le build (plus de blocage).
          try { localStorage.setItem(`velbaz_brand_gate_${gateCompanyId}`, JSON.stringify({ companyId: gateCompanyId, msg, planMode })); } catch {}
          brandBuildRunRef.current = launchBuild;
          setPendingBrandBuild({ companyId: gateCompanyId });
          setChatLoading(false);
        } else {
          launchBuild();
        }
      } else if (shouldContinue && projectId) {
        // Backend resumed an interrupted build — start polling for progress
        build.resumeBuild(projectId);
      }
    } catch (e: any) {
      abortRef.current = null;
      const partialContent = streamingContentRef.current;
      setStreamingContent('');
      streamingContentRef.current = '';
      // Bake any live edit steps into history so they aren't lost on error/abort.
      if (editStepsRef.current.length > 0) {
        const baked = editStepsRef.current;
        setMessages(prev => {
          const have = new Set(prev.map(m => m.id));
          return [...prev, ...baked.filter(s => !have.has(s.id))].sort((a, b) => a.time.getTime() - b.time.getTime());
        });
        editStepsRef.current = [];
        setEditSteps([]);
      }
      if (e.name === 'AbortError') {
        window.clearInterval(watchdog);
        setChatLoading(false);
        setSiteEditLoading(false);
        sendingRef.current = false;
        // The stream died (mobile backgrounding, dead proxy, watchdog…), but the
        // server finishes the reply and saves it to the DB regardless. Try to
        // recover that saved reply from history BEFORE assuming nothing happened.
        // Only if nothing was recovered do we fall back to the partial/timeout UX.
        if (!partialContent?.trim()) {
          const recovered = await syncMissedReplies().catch(() => 0);
          if (recovered > 0) return; // real reply restored — no error message needed
        }
        // Save any partial AI response so it's not lost
        if (partialContent?.trim()) {
          setMessages(prev => [...prev, { id: `a-partial-${Date.now()}`, role: 'assistant', content: partialContent.trim(), model: 'velbaz', time: new Date() }]);
        } else if (watchdogFired) {
          // Nothing streamed and nothing saved server-side → genuinely interrupted.
          setMessages(prev => [...prev, { id: `a-timeout-${Date.now()}`, role: 'assistant', content: '⏱️ The connection was interrupted before a response. Try your request again — if it persists, rephrase it shorter.', model: 'velbaz', time: new Date() }]);
        }
        return;
      }
      // ── In-project edit interrupted (long Claude Opus edit, dropped SSE) ──
      // Falling back to the generic /api/chat here is misleading: that endpoint
      // has NO idea a real project/app edit was in progress and answers as if
      // this were a fresh conversation (can even claim to "create a company").
      // For an existing project, be honest instead: the edit is probably still
      // running server-side (no code-level timeout on Claude Opus) — tell the
      // user and let them retry/re-ask rather than showing a confusing reply
      // or a generic "Something went wrong".
      if (projectId && (isReactProjectChat || hasExistingWebsite)) {
        console.warn('[chat] app-edit stream interrupted, skipping misleading generic fallback:', e?.message);
        // The edit runs server-side and its reply is saved to the DB even if this
        // connection dropped (common on mobile when backgrounding). Recover the
        // saved reply first; only warn if nothing was actually saved.
        const recovered = await syncMissedReplies().catch(() => 0);
        if (!recovered) {
          setMessages(prev => [...prev, { id: `edit-interrupted-${Date.now()}`, role: 'assistant', content: "⚠️ The connection was cut during the modification (it can take a while). It may still be running in the background — check the preview in a few moments, or try your request again.", model: 'velbaz', time: new Date() }]);
        }
        setChatLoading(false);
        setSiteEditLoading(false);
        sendingRef.current = false;
        return;
      }
      try {
        const res: any = await api.chat.send({ message: msg, sessionId: effectiveSessionId, model: 'google/gemini-3-flash', tier: modelTier, companyId: effectiveId || undefined });
        const fallbackContent = (res.reply || '...').replace(/\[BUILD_COMPANY\]/g, '').trim();
        const fbPopup = extractPopup(fallbackContent);
        if (fbPopup) {
          if (fbPopup.rest) setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: fbPopup.rest, model: res.model || 'google/gemini-3-flash', time: new Date() }]);
          setPendingPopup(fbPopup.popup);
          didFinish = true;
          setChatLoading(false);
          return;
        }
        const fallbackQMatch = fallbackContent.match(/\[QUESTIONS\]([\s\S]*)\[\/QUESTIONS\]/)
          || fallbackContent.match(/\[QUESTIONS\]([\s\S]*$)/);
        let fbQuestionsParsed = false;
        if (fallbackQMatch) {
          const introText = fallbackContent
            .replace(/\[QUESTIONS\][\s\S]*\[\/QUESTIONS\]/g, '')
            .replace(/\[QUESTIONS\][\s\S]*$/g, '')
            .trim();
          if (introText) setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: introText, model: res.model || 'google/gemini-3-flash', time: new Date() }]);
          try {
            let jsonStr = fallbackQMatch[1].replace(/\[\/QUESTIONS\].*$/, '').trim();
            const firstBracket = jsonStr.indexOf('[');
            const lastBracket = jsonStr.lastIndexOf(']');
            if (firstBracket !== -1 && lastBracket > firstBracket) {
              jsonStr = jsonStr.substring(firstBracket, lastBracket + 1);
            }
            let parsed: any;
            try { parsed = JSON.parse(jsonStr); } catch {
              let repaired = jsonStr;
              const openBraces = (repaired.match(/\{/g) || []).length;
              const closeBraces = (repaired.match(/\}/g) || []).length;
              for (let i = 0; i < openBraces - closeBraces; i++) repaired += '}';
              const openBrackets = (repaired.match(/\[/g) || []).length;
              const closeBrackets = (repaired.match(/\]/g) || []).length;
              for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += ']';
              try { parsed = JSON.parse(repaired); } catch { parsed = null; }
            }
            if (Array.isArray(parsed) && parsed.length > 0) {
              const validQs = parsed.filter((q: any) => q && typeof q.q === 'string' && q.q.length > 2);
              if (validQs.length > 0) {
                setPendingQuestions(validQs);
                setQuestionIndex(0);
                setQuestionAnswers({});
                fbQuestionsParsed = true;
              }
            }
          } catch {}
        }
        if (!fbQuestionsParsed) {
          const cleaned = fallbackContent
            .replace(/\[QUESTIONS\][\s\S]*\[\/QUESTIONS\]/g, '')
            .replace(/\[QUESTIONS\][\s\S]*$/g, '')
            .replace(/\[\/QUESTIONS\]/g, '')
            .trim();
          if (cleaned) setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: cleaned, model: res.model || 'google/gemini-3-flash', time: new Date() }]);
        }
        didFinish = true;
        if (res.shouldBuild) {
          // Keep loading while triggerBuild runs
          triggerBuild(msg).finally(() => setChatLoading(false));
        } else {
          setChatLoading(false);
        }
      } catch {
        setMessages(prev => [...prev, { id: `err-${Date.now()}`, role: 'assistant', content: 'Something went wrong. Try again.', model: 'velbaz', time: new Date() }]);
      }
    }

    if (!didFinish) {
      setChatLoading(false);
      setSiteEditLoading(false);
      setStreamingContent('');
      abortRef.current = null;
    }
    sendingRef.current = false;
    inputRef.current?.focus();
  }

  // ── Plan mode: generate a plan instead of sending directly ──
  async function generatePlan(msg: string, extraDetails?: string): Promise<boolean> {
    // Note : on vérifie le token (pas le state `user`) car au premier rendu
    // après navigation depuis l'accueil, `user` n'est pas encore hydraté.
    if (!user && !localStorage.getItem('velbaz_token')) { setShowAuthModal(true); return false; }
    let ok = false;
    setPlanLoading(true);
    setPlanDetailsMode(false);
    setPlanDetailsInput('');
    try {
      const token = localStorage.getItem('velbaz_token');
      const res = await fetch('/api/plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ message: msg, previousPlan: planData || undefined, extraDetails }),
      });
      const data = await res.json();
      if (data.success && data.plan) {
        setPlanData(data.plan);
        setPlanOriginalMsg(msg);
        ok = true;
      } else {
        setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: `❌ ${data.error || 'Unable to generate the plan.'}`, model: 'velbaz', time: new Date() }]);
      }
    } catch {
      setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: '❌ Error while generating the plan.', model: 'velbaz', time: new Date() }]);
    }
    setPlanLoading(false);
    return ok;
  }

  function validatePlan() {
    if (!planData) return;
    const planBlock = `[PLAN APPROVED BY USER — follow this plan step by step]\n# ${planData.title}\n${planData.summary || ''}\n${planData.steps.map((s, i) => `${i + 1}. ${s.title}${s.description ? ` — ${s.description}` : ''}`).join('\n')}`;
    const planText = `${planOriginalMsg}\n\n${planBlock}`;
    const wasForBuild = planForBuild;
    setPlanData(null);
    setPlanOriginalMsg('');
    setPlanDetailsMode(false);
    setPlanForBuild(false);
    // Le mode Plan se désactive tout seul après validation : le prochain
    // message repart en mode normal (sinon chaque envoi regénérait un plan).
    setPlanMode(false);
    try { sessionStorage.removeItem('velbaz_plan_mode'); } catch { /* ignore */ }
    if (wasForBuild) {
      // Plan pré-build validé → lancer directement la construction avec le plan
      setMessages(prev => [...prev, { id: `plan-go-${Date.now()}`, role: 'assistant', content: '🚀 Plan validated — launching the construction of your project...', model: 'velbaz', time: new Date() }]);
      setChatLoading(true);
      triggerBuild(planText, planBlock).finally(() => setChatLoading(false));
    } else {
      doSend(planText);
    }
  }

  // ── Flux de création de pub (conversationnel, inline) ──────────────────────
  // Détecte l'intention "fais une pub" et ouvre un pop-up de questions au-dessus
  // de la barre de saisie. On ne pose que les questions manquantes.
  const AD_INTENT_RE = /\bpub\b|\bpublicit[ée]|\bannonces?\b|\bugc\b|\bpromo\b|\badvert|\bcommercial\b|\bspot\s*pub|\bads?\b/i;
  const AD_VERB_RE = /\b(fais|cr[ée]{1,2}e?r?|g[ée]n[èe]re?r?|je\s+veux|besoin|make|create|generate|build)\b/i;

  function detectAdIntent(msg: string): boolean {
    if (!AD_INTENT_RE.test(msg)) return false;
    // "une pub", "fais moi une pub", "crée une publicité", "pub ugc"...
    return AD_VERB_RE.test(msg) || /^\s*(une?\s+)?(pub|publicit[ée]|annonce|ugc)/i.test(msg);
  }

  // Ordre des questions ; "avatar" et "voice" seulement si style = UGC.
  function nextAdKey(a: AdAnswers): string | null {
    if (!a.subject) return 'subject';
    if (!a.style) return 'style';
    if (a.style === 'ugc') {
      if (!a.avatarId) return 'avatar';
      if (!a.voice) return 'voice';
    }
    if (!a.format) return 'format';
    if (!a.duration) return 'duration';
    if (!a.language) return 'language';
    if (!a.message) return 'message';
    return null;
  }

  // Pré-remplissage léger depuis le message initial (pour sauter des questions).
  function parseAdHints(msg: string): AdAnswers {
    const a: AdAnswers = {};
    const low = msg.toLowerCase();
    if (/\bugc\b|cr[ée]ateur|influenceu|t[ée]moignage|qui parle/.test(low)) a.style = 'ugc';
    else if (/motion|anim[ée]|produit qui|3d/.test(low)) a.style = 'motion';
    if (/9\s*[:x]\s*16|vertical|tiktok|reels?|shorts?|story|stories/.test(low)) a.format = '9:16';
    else if (/16\s*[:x]\s*9|paysage|youtube|horizontal/.test(low)) a.format = '16:9';
    else if (/1\s*[:x]\s*1|carr[ée]|square/.test(low)) a.format = '1:1';
    if (/\bfran[çc]ais|\bfr\b/.test(low)) a.language = 'French';
    else if (/\benglish|anglais|\ben\b/.test(low)) a.language = 'English';
    return a;
  }

  function startAdFlow(msg: string) {
    if (!user && !localStorage.getItem('velbaz_token')) { setShowAuthModal(true); return; }
    setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', content: msg, time: new Date() }]);
    setInput('');
    const hints = parseAdHints(msg);
    setAdTextInput('');
    setAdFlow({ answers: hints });
    // Si la 1re question manquante est l'avatar, précharge la liste Higgsfield.
    if (nextAdKey(hints) === 'avatar') void fetchAdAvatars();
  }

  async function fetchAdAvatars() {
    if (adAvatars.length > 0 || adAvatarsLoading || !projectId) return;
    setAdAvatarsLoading(true);
    try {
      const r = await fetch(`/api/companies/${projectId}/higgsfield/soul-ids`, { headers: authHeaders() });
      const d = await r.json();
      const items = (d.items || d.soul_ids || []) as any[];
      setAdAvatars(items.map(it => ({ id: it.id, name: it.name || 'Avatar', preview_url: it.preview_url, thumbnail_url: it.thumbnail_url })));
    } catch { /* garde une liste vide → on affiche un champ libre */ }
    setAdAvatarsLoading(false);
  }

  function answerAd(key: string, value: string, extra?: Partial<AdAnswers>) {
    setAdFlow(prev => {
      if (!prev) return prev;
      const answers = { ...prev.answers, [key]: value, ...extra };
      const next = nextAdKey(answers);
      if (next === 'avatar') void fetchAdAvatars();
      if (next === null) { void submitAd(answers); return null; }
      return { answers };
    });
    setAdTextInput('');
  }

  // Construit la config d'une question de pub, dans le même format que QuestionTool
  // (celui utilisé au début pour les questions). Une question à la fois.
  function adQuestionConfig(key: string): QuestionConfig {
    switch (key) {
      case 'subject':
        return { q: 'What do you want to promote? (an app or a product)', kind: 'text', placeholder: 'E.g.: my fitness app "FitGlow", an organic face serum…' };
      case 'style':
        return { q: 'What style of ad?', kind: 'single', options: [
          { id: 'ugc', label: 'UGC', description: '— a creator talking to camera' },
          { id: 'motion', label: 'Motion', description: '— animated / cinematic product' },
          { id: 'autre', label: 'Other', description: '— let the AI decide' },
        ] };
      case 'avatar':
        return { q: 'Choose an avatar (UGC creator)', kind: 'single', options: [
          ...adAvatars.map(av => ({ id: av.id, label: av.name })),
          { id: 'auto', label: adAvatars.length > 0 ? 'Laisser l’IA choisir un avatar' : 'Aucun avatar dispo — laisser l’IA choisir' },
        ] };
      case 'voice':
        return { q: 'What voice?', kind: 'single', options: ['Energetic female', 'Soft female', 'Dynamic male', 'Calm male', 'Neutral / AI'].map(v => ({ id: v, label: v })) };
      case 'format':
        return { q: 'What format?', kind: 'single', options: [
          { id: '9:16', label: '9:16', description: '· Vertical (TikTok, Reels)' },
          { id: '16:9', label: '16:9', description: '· Landscape (YouTube)' },
          { id: '1:1', label: '1:1', description: '· Square (feed)' },
        ] };
      case 'duration':
        return { q: 'What duration?', kind: 'single', options: [
          { id: 'court', label: 'Short', description: '(~5s)' },
          { id: 'moyen', label: 'Medium', description: '(~10s)' },
          { id: 'long', label: 'Long', description: '(~15s)' },
        ] };
      case 'language':
        return { q: 'What language?', kind: 'single', allowCustom: true, customPlaceholder: 'Other language…', options: ['French', 'English', 'Español', 'العربية', 'Nederlands'].map(v => ({ id: v, label: v })) };
      case 'message':
      default:
        return { q: 'Quel est le message / l’accroche ?', kind: 'text', placeholder: 'E.g.: "Transform your routine in 30 days"' };
    }
  }

  // Traduit la réponse (label renvoyé par QuestionTool) vers la valeur interne + extra.
  function onAdAnswer(key: string, cfg: QuestionConfig, answer: string) {
    const opt = cfg.options?.find(o => o.label === answer);
    const val = opt ? opt.id : answer;
    if (key === 'avatar') {
      if (val === 'auto') answerAd('avatarId', 'auto', { avatarName: 'au choix de l’IA' });
      else { const av = adAvatars.find(x => x.id === val); answerAd('avatarId', val, { avatarName: av?.name }); }
      return;
    }
    answerAd(key, val);
  }

  // Skip → valeur par défaut raisonnable pour continuer le flux (sinon on annule).
  function onAdSkip(key: string) {
    const defaults: Record<string, [string, Partial<AdAnswers>?]> = {
      style: ['autre'],
      avatar: ['auto', { avatarName: 'au choix de l’IA' }],
      voice: ['Neutral / AI'],
      format: ['9:16'],
      duration: ['moyen'],
      language: ['French'],
      message: ['au choix de l’IA'],
    };
    const d = defaults[key];
    if (!d) { setAdFlow(null); setAdTextInput(''); return; } // 'subject' non skippable → annule
    answerAd(key === 'avatar' ? 'avatarId' : key, d[0], d[1]);
  }

  const pollAdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function pollHiggsfield(jobId: string, isVideo: boolean) {
    const tick = async () => {
      try {
        const r = await fetch(`/api/companies/${projectId}/higgsfield/jobs/${jobId}`, { headers: authHeaders() });
        const d = await r.json();
        const job = d.job || d;
        const status = job.status as string;
        if (status === 'completed') {
          const outputs: string[] = job.outputUrls ? JSON.parse(job.outputUrls) : (job.outputUrl ? [job.outputUrl] : []);
          const toks = outputs.map(u => isVideo ? `[VIDEO:${u.startsWith('http') ? u : window.location.origin + u}]` : `[IMG:${u}]`).join('\n');
          upsertHiggsfieldMessage(`hf-${jobId}`, `🎬 Your ad is ready:\n\n${toks}`);
          return;
        }
        if (status === 'skipped') {
          upsertHiggsfieldMessage(`hf-${jobId}`, `⏭️ Higgsfield step skipped — your Higgsfield account has no credits. Nothing was charged. Top up your Higgsfield credits and try again to generate the real ad.`);
          return;
        }
        if (status === 'failed' || status === 'nsfw' || status === 'canceled') {
          upsertHiggsfieldMessage(`hf-${jobId}`, `⚠️ Generation ${status}${job.error ? ' — ' + job.error : ''}.`);
          return;
        }
        pollAdRef.current = setTimeout(tick, 2000);
      } catch { pollAdRef.current = setTimeout(tick, 3000); }
    };
    tick();
  }

  async function submitAd(a: AdAnswers) {
    setAdSubmitting(true);
    const styleLabel = a.style === 'ugc' ? 'UGC (creator talking)' : a.style === 'motion' ? 'Motion (animated product)' : 'Video';
    const promptParts = [
      `Ad ${styleLabel} for ${a.subject}.`,
      a.message ? `Hook: "${a.message}".` : '',
      a.avatarName ? `Avatar: ${a.avatarName}.` : '',
      a.voice ? `Voice: ${a.voice}.` : '',
      a.format ? `Format ${a.format},` : '',
      a.duration ? `duration ${a.duration},` : '',
      a.language ? `language ${a.language}.` : '',
    ].filter(Boolean).join(' ');

    const recap = [
      `**Creating your ad** 🎬`,
      `• Subject: ${a.subject}`,
      `• Style: ${styleLabel}`,
      a.avatarName ? `• Avatar: ${a.avatarName}` : '',
      a.voice ? `• Voice: ${a.voice}` : '',
      `• Format: ${a.format} · Duration: ${a.duration} · Language: ${a.language}`,
    ].filter(Boolean).join('\n');
    setMessages(prev => [...prev, { id: `ad-recap-${Date.now()}`, role: 'assistant', content: recap, model: 'higgsfield', time: new Date() }]);

    try {
      // Nouvelle pipeline "pub vidéo" : Velbaz décide l'archétype selon le secteur
      // (mode/vêtements → video try-on ; autre → UGC AI vidéo). Sortie TOUJOURS vidéo.
      // Si l'utilisateur a explicitement choisi UGC on force cet archétype, sinon 'auto'.
      const archetype = a.style === 'ugc' ? 'ugc' : undefined;
      const r = await fetch(`/api/companies/${projectId}/ads/video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          prompt: promptParts, sessionId, archetype, format: a.format, duration: a.duration,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMessages(prev => [...prev, { id: `ad-err-${Date.now()}`, role: 'assistant', content: `❌ ${d.error || 'Error generating the ad.'}`, model: 'higgsfield', time: new Date() }]);
      } else {
        const kindLabel = d.archetype === 'tryon' ? 'video try-on' : 'UGC video';
        upsertHiggsfieldMessage(`hf-${d.jobId}`, `⏳ Creating your ${kindLabel} ad… (mannequin, dressing then video animation)`);
        pollHiggsfield(d.jobId, true);
      }
    } catch {
      setMessages(prev => [...prev, { id: `ad-err-${Date.now()}`, role: 'assistant', content: '❌ Network error while generating the ad.', model: 'higgsfield', time: new Date() }]);
    }
    setAdSubmitting(false);
  }

  // ── Growth Engine : détecte "prospecte / trouve des clients / lance une campagne"
  // → lance une campagne full-auto (démo par défaut) et affiche le résultat dans le chat.
  const GROWTH_INTENT_RE = /\b(prospect(e|er|ion)?|trouve(-|\s)?(moi\s+)?(des\s+)?(clients?|leads?|prospects?)|g[ée]n[èe]re?r?\s+(des\s+)?(leads?|clients?)|campagne\s+(de\s+)?(prospection|croissance|outreach|mailing)|d[ée]marche\s+(des\s+)?(clients?|prospects?)|outreach|fais\s+grandir\s+(mon|l['e])\s*(entreprise|bo[iî]te)|acqui(ir|s)ition\s+client)/i;
  function detectGrowthIntent(msg: string): boolean {
    if (AD_INTENT_RE.test(msg) && !/prospect|client|lead|outreach/i.test(msg)) return false; // laisse la pub à detectAdIntent
    return GROWTH_INTENT_RE.test(msg);
  }

  async function runGrowthCampaign(msg: string) {
    if (!user && !localStorage.getItem('velbaz_token')) { setShowAuthModal(true); return; }
    setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', content: msg, time: new Date() }]);
    setInput('');
    const runId = `growth-${Date.now()}`;
    setMessages(prev => [...prev, { id: runId, role: 'assistant', content: '🚀 Launching a fully automated growth campaign (leads → email/SMS/AI call/avatar video → follow-ups)…', model: 'growth', time: new Date() }]);
    try {
      const r = await fetch(`/api/companies/${projectId}/growth/campaign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ count: 8, goal: msg }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMessages(prev => prev.map(m => m.id === runId ? { ...m, content: `❌ ${d.error || 'Unable to launch the campaign.'}` } : m));
        return;
      }
      const total = (d.outreach || []).length;
      const byCh = (d.outreach || []).reduce((acc: any, x: any) => { acc[x.channel] = (acc[x.channel] || 0) + 1; return acc; }, {});
      const demoNote = d.demoMode ? '\n\n🟠 **Demo mode**: no spending, no real sending. Connect the keys (Resend, Twilio, Bland AI) to go live.' : '';
      const summary = [
        `✅ **Campaign launched** — ${(d.leads || []).length} targeted leads, ${total} autonomous actions.`,
        `• Email: ${byCh.email || 0}  · SMS: ${byCh.sms || 0}  · AI calls: ${byCh.call || 0}  · Avatar video: ${byCh.video || 0}`,
        `• Automatic follow-ups scheduled at D+3 for emails.`,
        `Open the project's **Growth** tab to see leads, actions and statuses in real time.${demoNote}`,
      ].join('\n');
      setMessages(prev => prev.map(m => m.id === runId ? { ...m, content: summary } : m));
    } catch {
      setMessages(prev => prev.map(m => m.id === runId ? { ...m, content: '❌ Network error while launching the campaign.' } : m));
    }
  }

  // ── Pack Visibilité & Presse : détecte "rends mon app visible / trouve des
  // journalistes / propose une newsletter / un blog / communiqué de presse"
  // → régénère le pack PR/contenu et l'affiche dans le chat (chips + proposition).
  const VISIBILITY_INTENT_RE = /\b(rends?[-\s]?(la|le|mon|ma)?\s*(app|appli|application|site|projet|entreprise)?\s*(plus\s+)?(visible|connue?|c[ée]l[èe]bre)|fais[-\s]?(la|le|toi)?\s*conna[iî]tre|se\s+faire\s+conna[iî]tre|notori[ée]t[ée]|relations?\s+presse|communiqu[ée]\s+de\s+presse|journalistes?|m[ée]dias?|couverture\s+m[ée]diatique|newsletter|infolettre|un\s+blog|articles?\s+de\s+blog|fiche\s+wikip[ée]dia|encyclop[ée]diqu?e?|annuaires?)\b/i;
  function detectVisibilityIntent(msg: string): boolean {
    if (detectGrowthIntent(msg)) return false; // la prospection reste au Growth Engine
    return VISIBILITY_INTENT_RE.test(msg);
  }

  async function runVisibilityPlan(msg: string) {
    if (!user && !localStorage.getItem('velbaz_token')) { setShowAuthModal(true); return; }
    setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', content: msg, time: new Date() }]);
    setInput('');
    const runId = `vis-${Date.now()}`;
    setMessages(prev => [...prev, { id: runId, role: 'assistant', content: "📰 I'm thinking about how to get you known: searching for real journalists, press release, blog, newsletter, directories, encyclopedia entry…", model: 'growth', time: new Date() }]);
    try {
      const r = await fetch(`/api/companies/${projectId}/visibility/plan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ goal: msg }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMessages(prev => prev.map(m => m.id === runId ? { ...m, content: `❌ ${d.error || 'Unable to generate the visibility pack.'}` } : m));
        return;
      }
      setMessages(prev => prev.map(m => m.id === runId ? { ...m, content: d.content || d.intro || '✅ Visibility pack ready.' } : m));
    } catch {
      setMessages(prev => prev.map(m => m.id === runId ? { ...m, content: '❌ Network error while generating the visibility pack.' } : m));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ── Référence de fichiers via "/" ──────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  // Charge la liste des fichiers du projet quand le menu "/" s'ouvre.
  useEffect(() => {
    if (!slashOpen || !projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const r: any = await api.companies.projectFiles.list(projectId);
        if (cancelled) return;
        const files = Array.isArray(r?.files) ? r.files : [];
        setProjFiles(files.map((f: any) => ({
          path: f.path as string,
          name: (f.path as string).split('/').pop() || (f.path as string),
          type: f.type as string,
        })));
      } catch { /* silencieux */ }
    })();
    return () => { cancelled = true; };
  }, [slashOpen, projectId]);

  // Commandes slash (au-dessus des fichiers). Pour l'instant : /genesis.
  const slashCommands = useMemo(() => filterSlashCommands(slashQuery), [slashQuery]);

  // Liste combinée (fichiers projet + documents joints) filtrée par le texte tapé.
  const slashResults = useMemo(() => {
    const q = slashQuery.trim().toLowerCase();
    const attFiles: PickedFile[] = attachments
      .filter(a => a.type !== 'image')
      .map(a => ({ kind: 'attachment' as const, path: a.name, name: a.name, type: 'joint', attId: a.id }));
    const projItems: PickedFile[] = projFiles.map(f => ({ kind: 'project' as const, path: f.path, name: f.name, type: f.type }));
    const all = [...attFiles, ...projItems];
    const filtered = q
      ? all.filter(f => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
      : all;
    return filtered.slice(0, 40);
  }, [slashQuery, projFiles, attachments]);

  // Gère la frappe dans le textarea : détecte "/" pour ouvrir/mettre à jour le menu.
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setInput(val);
    const caret = e.target.selectionStart ?? val.length;
    // Commande valide tapée à la main en tête de prompt → devient une puce.
    const typed = val.match(/^\/([a-zA-Z]+)[ \n]/);
    if (typed && !cmdChip && filterSlashCommands(typed[1]).some(c => c.cmd === typed[1].toLowerCase())) {
      setCmdChip(typed[1].toLowerCase());
      setInput(val.slice(typed[0].length));
      setSlashOpen(false);
      slashStartRef.current = -1;
      return;
    }
    // Cherche un "/" en début de ligne ou précédé d'un espace, sans espace après.
    let start = -1;
    for (let i = caret - 1; i >= 0; i--) {
      const ch = val[i];
      if (ch === '/') {
        const prev = i === 0 ? '' : val[i - 1];
        if (i === 0 || prev === ' ' || prev === '\n') start = i;
        break;
      }
      if (ch === ' ' || ch === '\n') break; // token cassé → pas de "/"
    }
    if (start >= 0) {
      const query = val.slice(start + 1, caret);
      if (!/\s/.test(query)) {
        slashStartRef.current = start;
        setSlashQuery(query);
        setSlashIndex(0);
        setSlashOpen(true);
        return;
      }
    }
    if (slashOpen) { setSlashOpen(false); slashStartRef.current = -1; }
  }

  // Insère le fichier choisi : retire le "/query" du texte et ajoute une puce.
  function pickSlashFile(file: PickedFile) {
    const start = slashStartRef.current;
    if (start >= 0) {
      const el = inputRef.current;
      const caret = el?.selectionStart ?? input.length;
      const before = input.slice(0, start);
      const after = input.slice(caret);
      const next = (before + after).replace(/\s+$/, '') ;
      setInput(next);
    }
    setPickedFiles(prev => prev.some(p => p.kind === file.kind && p.path === file.path) ? prev : [...prev, file]);
    setSlashOpen(false);
    setSlashQuery('');
    slashStartRef.current = -1;
    // Redonne le focus au textarea.
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  // Insère une commande choisie dans le menu "/" (ex. « /genesis »).
  function pickSlashCommand(cmd: string) {
    const start = slashStartRef.current;
    const el = inputRef.current;
    const caret = el?.selectionStart ?? input.length;
    const before = start >= 0 ? input.slice(0, start) : input;
    const after = start >= 0 ? input.slice(caret) : '';
    // La commande devient une puce dans la barre — elle sort du texte tapé.
    setCmdChip(cmd);
    setInput((before + after).replace(/^\s+/, ''));
    setSlashOpen(false);
    setSlashQuery('');
    slashStartRef.current = -1;
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function removePickedFile(file: PickedFile) {
    setPickedFiles(prev => prev.filter(p => !(p.kind === file.kind && p.path === file.path)));
  }

  // Construit le bloc de contexte (chemin + contenu) pour les fichiers référencés.
  // Renvoyé séparément du message affiché : la bulle reste propre, l'IA reçoit tout.
  async function buildReferencedContext(): Promise<string> {
    if (pickedFiles.length === 0) return '';
    const blocks: string[] = [];
    for (const f of pickedFiles) {
      if (f.kind === 'attachment') {
        const att = attachments.find(a => a.id === f.attId);
        let content = '';
        if (att?.data) {
          try {
            const comma = att.data.indexOf(',');
            const b64 = comma >= 0 ? att.data.slice(comma + 1) : att.data;
            content = decodeURIComponent(escape(atob(b64)));
          } catch { content = '[contenu binaire non affichable]'; }
        }
        blocks.push(`[Fichier joint: ${f.name}]\n${content}`);
      } else if (projectId) {
        try {
          const r: any = await api.companies.projectFiles.content(projectId, f.path);
          blocks.push(`[Fichier du projet: ${f.path}]\n${r?.content ?? ''}`);
        } catch {
          blocks.push(`[Fichier du projet: ${f.path}]\n[contenu introuvable]`);
        }
      }
    }
    return `\n\n--- Fichiers référencés par l'utilisateur (chemin + contenu) ---\n${blocks.join('\n\n')}\n--- Fin des fichiers référencés ---`;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ── Moteur /genesis : pipeline de raisonnement en 8 phases ─────────────
  // ═══════════════════════════════════════════════════════════════════════
  // Aucune génération visuelle n'est lancée avant la fin de la phase 4 (c'est
  // le backend qui l'impose). Ici on se contente de streamer et d'afficher.
  // À la fin, la spec de précision est renvoyée à l'IA comme brief caché pour
  // que la construction parte d'un cahier des charges exact au lieu du prompt.
  // ── Porte de choix du moteur /genesis ────────────────────────────────────
  // Le moteur montre une planche de propositions et attend : soit l'utilisateur
  // clique celle qu'il préfère, soit il écrit ce qu'il veut voir à la place.
  async function sendGenesisChoice(runId: string, body: { pick?: string; prompt?: string }) {
    setGenesisChoiceBusy(true);
    try {
      const res = await fetch('/api/genesis/choose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ runId, ...body }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGenesisRun(prev => (prev ? { ...prev, choice: null } : prev));
      setGenesisChoiceText('');
    } catch (e: any) {
      console.warn('[genesis] choix KO →', e?.message);
    } finally {
      setGenesisChoiceBusy(false);
    }
  }

  async function runGenesisFlow(rawMsg: string) {
    if (!user) { setShowAuthModal(true); return; }
    const brief = rawMsg.replace(/^\/(genesis|vision)\b[\s:]*/i, '').trim();
    if (!brief) {
      setMessages(prev => [...prev, {
        id: `a-${Date.now()}`, role: 'assistant', time: new Date(),
        content: "Tape `/genesis` suivi de ton idée — par exemple : `/genesis crée-moi une marque de chaussures`.",
      }]);
      setInput('');
      return;
    }

    // On affiche uniquement l'idée de l'utilisateur, sans la commande interne.
    setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', content: brief, time: new Date() }]);
    setInput('');
    setGenesisRun(emptyGenesisRun(`pending-${Date.now()}`, brief));

    try {
      const res = await fetch('/api/genesis/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ message: rawMsg, sessionId }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let finalSpec = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() || '';
        for (const part of parts) {
          const line = part.split('\n').find(l => l.startsWith('data: '));
          if (!line) continue;
          let ev: any;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }

          setGenesisRun(prev => {
            if (!prev) return prev;
            const next: GenesisRunState = { ...prev, phases: [...prev.phases] };
            if (ev.type === 'start') next.runId = ev.runId;
            if (ev.type === 'phase_start') {
              next.phases = next.phases.map(p => p.phase === ev.phase ? { ...p, status: 'running' as const } : p);
            }
            if (ev.type === 'phase_done') {
              next.phases = next.phases.map(p => p.phase === ev.phase ? { ...p, status: 'done' as const, output: ev.output, ms: ev.ms } : p);
              // La phase 6 (critique) est exécutée à l'intérieur de la phase 5 côté
              // moteur : on la marque terminée dès que des critiques sont arrivées.
              if (ev.phase === 5 && next.critiques.length) {
                next.phases = next.phases.map(p => p.phase === 6 ? { ...p, status: 'done' as const } : p);
              }
            }
            if (ev.type === 'asset') next.assets = [...next.assets, ev.asset];
            if (ev.type === 'critique') {
              next.critiques = [...next.critiques, ev.critique];
              next.phases = next.phases.map(p => p.phase === 6 ? { ...p, status: 'running' as const } : p);
              next.assets = next.assets.map(a =>
                a.elementId === ev.critique.elementId && a.variant === ev.critique.variant
                  ? { ...a, score: ev.critique.average } : a);
            }
            if (ev.type === 'note') next.notes = [...next.notes, ev.text];
            // Le moteur attend un clic de l'utilisateur sur une proposition.
            if (ev.type === 'choice') {
              next.choice = {
                runId: ev.runId, round: ev.round, question: ev.question,
                canAskMore: ev.canAskMore, options: ev.options ?? [],
              };
            }
            if (ev.type === 'choice_done') next.choice = null;
            if (ev.type === 'done') {
              next.status = 'done';
              next.spec = ev.result?.spec || '';
              next.phases = next.phases.map(p => ({ ...p, status: 'done' as const }));
            }
            if (ev.type === 'error') { next.status = 'error'; next.error = ev.message; }
            return next;
          });

          if (ev.type === 'done') finalSpec = ev.result?.spec || '';
          if (ev.type === 'error') throw new Error(ev.message);
        }
      }

      if (!finalSpec) {
        setMessages(prev => [...prev, {
          id: `a-${Date.now()}`, role: 'assistant', time: new Date(),
          content: "Je lance la création.",
        }]);
        doSend(brief, undefined, { hidden: true });
      }

      if (finalSpec) {
        // La spec (= la mécanique interne) reste PRIVÉE : on ne l'affiche pas
        // dans le chat, elle part uniquement en brief caché vers la construction.
        setMessages(prev => [...prev, {
          id: `a-${Date.now()}`, role: 'assistant', time: new Date(),
          content: "J'ai fini de réfléchir. Je lance la création.",
        }]);
        // Brief caché : la construction part de la spec, pas du prompt initial.
        doSend(
          `Construis maintenant en suivant EXACTEMENT cette spec de précision. Aucune dérive, aucune valeur approximative, aucune substitution d'élément. IMPORTANT : « genesis » est le nom d'une commande interne, jamais le nom de la marque ni un élément du brief — ignore ce mot totalement et n'en fais aucun usage dans le naming.\n\nEXIGENCES DE DESIGN NON NÉGOCIABLES (une page correcte mais banale = échec) :\n- Applique le patron de hero éditorial nommé dans la spec : typographie display géante (≥ 12vw en desktop, letter-spacing négatif), sujet photographique détouré posé devant ou derrière les lettres selon l'ordre de z-index donné. Jamais de hero centré titre + sous-titre + deux boutons.\n- Utilise la police exacte de la spec via sa source réelle. Interdits : Inter, Roboto, Space Grotesk, Open Sans, Poppins par défaut.\n- Respecte les hex exacts : 2 couleurs dominantes maximum + 1 accent. Pas de dégradé violet sur blanc, pas d'ombre portée molle générique, pas de grille de cartes arrondies interchangeables.\n- Utilise les assets réellement générés listés dans la spec. Aucun placeholder, aucune illustration vectorielle de remplacement, aucune image de stock générique.\n- Garde au moins une zone de silence visuel volontaire, des alignements de bord francs, un filet fin de séparation et un bloc de méta-informations en petit corps.\n- Chaque hover et chaque animation d'entrée reprend les durées, delays et easings exacts de la spec.\n\nSYSTÈME DE DESIGN COMMUN À TOUTES LES PAGES (non négociable) :\n- La spec commence par un bloc « DESIGN SYSTEM VERROUILLÉ » relevé sur la maquette validée : palette hex, polices et leurs sources, échelle typographique, grille, rayons, filets, style de nav, de boutons et de pied de page, traitement des images, durées et easings. Ces valeurs sont la loi.\n- Construis TOUTES les pages du site avec ce système, pas seulement la page d'accueil : pages internes, listes, fiches, à-propos, contact, formulaires, 404. Chaque page réutilise la même barre de navigation, le même pied de page, les mêmes composants et les mêmes couleurs.\n- Aucune page ne redéfinit une couleur d'accent, une police, un rayon, un style de bouton ou une densité différente. Une page qui dérive du système est un échec, même si elle est jolie.\n- Centralise le système en variables CSS et en composants réutilisés — pas de valeurs recopiées à la main page par page.\n- Toutes les pages doivent être réellement atteignables depuis la navigation, et aucune ne doit rester vide ou en placeholder.\n\nMÉCANIQUE D'INTERACTION NON NÉGOCIABLE (une page qui se contente de défiler = échec) :\n- La section « Machine d'interaction » de la spec est la partie la plus importante du document : implémente-la telle quelle, sans la simplifier et sans la remplacer par un défilement vertical classique.\n- Si le modèle de navigation de la spec n'est pas « vertical-scroll », il est INTERDIT de livrer une page qui défile : verrouille le défilement (html/body en overflow hidden), travaille en 100dvh, et pilote l'affichage par une machine à états unique (scène au repos + états nommés).\n- Câble toutes les entrées listées dans la spec (mouvement du curseur, molette détournée, glisser, clic, toucher, clavier) avec EXACTEMENT les seuils, amplitudes en px ou %, durées en ms et easings donnés. Aucune valeur inventée, aucun « effet fluide » vague.\n- Tout le contenu prévu doit rester atteignable par la mécanique (aucune information piégée dans un état inaccessible), et navigable au clavier avec un focus visible.\n- Prévois l'équivalent tactile décrit dans la spec, et un repli statique lisible sous prefers-reduced-motion.\n- Les trois réflexes refusés par la spec ne doivent apparaître nulle part dans le rendu final.\n\n${finalSpec}`,
          undefined,
          { hidden: true },
        );
      }
    } catch (e: any) {
      // Filet de sécurité : la réflexion peut échouer, la création NON. On
      // lance quand même la construction à partir du brief pour qu'un projet
      // existe toujours (avant, le chat restait bloqué sans rien créer).
      console.warn('[genesis] réflexion KO →', e?.message);
      setGenesisRun(prev => prev ? { ...prev, status: 'error', error: e?.message || 'échec du pipeline' } : prev);
      setMessages(prev => [...prev, {
        id: `a-${Date.now()}`, role: 'assistant', time: new Date(),
        content: "Je lance la création.",
      }]);
      doSend(brief, undefined, { hidden: true });
    }
  }

  async function sendMessage() {
    const msg = (cmdChip ? `/${cmdChip} ` : '') + input.trim();
    if (cmdChip) setCmdChip(null);
    // ── Commande /genesis : moteur de raisonnement en 8 phases avant génération ──
    if (/^\/(genesis|vision)\b/i.test(msg) && !chatLoading && !isBuildingThis && !genesisRun) {
      runGenesisFlow(msg);
      return;
    }
    // Fichiers référencés via "/" → on injecte leur contenu dans le message envoyé
    // (pas dans la bulle affichée). On vide les puces après.
    let appendContext = '';
    if (pickedFiles.length > 0) {
      appendContext = await buildReferencedContext();
    }
    if (appendContext && !adFlow && !chatLoading && !isBuildingThis && !planMode
        && !(msg && projectId && (detectGrowthIntent(msg) || detectVisibilityIntent(msg)))
        && !(msg && detectAdIntent(msg))) {
      setPickedFiles([]);
      doSend(msg, undefined, { appendContext });
      return;
    }
    if (msg && projectId && !adFlow && !chatLoading && !isBuildingThis && detectGrowthIntent(msg)) {
      runGrowthCampaign(msg);
      return;
    }
    if (msg && projectId && !adFlow && !chatLoading && !isBuildingThis && detectVisibilityIntent(msg)) {
      runVisibilityPlan(msg);
      return;
    }
    if (msg && !adFlow && !chatLoading && !isBuildingThis && detectAdIntent(msg)) {
      startAdFlow(msg);
      return;
    }
    if (planMode && msg && !chatLoading && !isBuildingThis) {
      setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', content: msg, time: new Date() }]);
      setInput('');
      generatePlan(msg);
      return;
    }
    doSend(msg);
  }
  function handleKeyDown(e: React.KeyboardEvent) {
    // Navigation dans le menu "/" quand il est ouvert.
    const slashTotal = slashCommands.length + slashResults.length;
    if (slashOpen && slashTotal > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex(i => (i + 1) % slashTotal); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex(i => (i - 1 + slashTotal) % slashTotal); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const idx = Math.min(slashIndex, slashTotal - 1);
        if (idx < slashCommands.length) pickSlashCommand(slashCommands[idx].cmd);
        else pickSlashFile(slashResults[idx - slashCommands.length]);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setSlashOpen(false); slashStartRef.current = -1; return; }
    }
    // Retour arrière au tout début du texte → retire la puce de commande.
    if (e.key === 'Backspace' && cmdChip && (inputRef.current?.selectionStart ?? 0) === 0 && (inputRef.current?.selectionEnd ?? 0) === 0) {
      e.preventDefault();
      setCmdChip(null);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  const { isListening, voiceBars, toggle: toggleVoice, stopListening } = voice;

  // Auto-grow the prompt textarea so typed/dictated text wraps onto new lines
  // and the bar expands instead of overflowing. Caps at maxHeight then scrolls.
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const next = Math.min(ta.scrollHeight, 200);
    ta.style.height = next + 'px';
    ta.style.overflowY = ta.scrollHeight > 200 ? 'auto' : 'hidden';
  }, [input, isListening]);

  // ── Ajoute un spécialiste à l'équipe puis rejoue la dernière demande ────────
  function addSpecialistAndResend(id: string) {
    if (!specialistsRef.current.includes(id)) {
      specialistsRef.current = [...specialistsRef.current, id];
      persistSpecialists();
    }
    // La demande à rejouer = le dernier message utilisateur (celui qui a été gaté).
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const toResend = lastUser?.content?.trim();
    if (toResend) {
      setTimeout(() => doSend(toResend), 60);
    }
  }

  function renderContent(text: string) {
    // Safety: strip any [QUESTIONS] or [BUILD_COMPANY] tags that may have leaked through
    text = text
      .replace(/\[QUESTIONS\][\s\S]*\[\/QUESTIONS\]/g, '')
      .replace(/\[QUESTIONS\][\s\S]*$/g, '')
      .replace(/\[\/QUESTIONS\]/g, '')
      .replace(/\[BUILD_COMPANY\]/g, '')
      .trim();

    // ── Bouton « Ajouter ce spécialiste » : [ADD_SPECIALIST:id|Label] ──────────
    // L'IA a détecté une demande hors de l'équipe choisie. On retire le marqueur
    // du texte et on affiche un bouton qui active l'agent puis rejoue la demande.
    let addSpecialist: { id: string; label: string } | null = null;
    const asMatch = text.match(/\[ADD_SPECIALIST:([a-z_]+)\|([^\]]+)\]/i);
    if (asMatch) {
      addSpecialist = { id: asMatch[1], label: asMatch[2] };
      text = text.replace(/\[ADD_SPECIALIST:[^\]]+\]/gi, '').trim();
    }

    // ── Calendrier visuel : [CALENDAR_VIEW]{json}[/CALENDAR_VIEW] ──
    // Rendu avec le vrai design + les vraies données injectées par le backend.
    let calendarView: CalViewData | null = null;
    const calMatch = text.match(/\[CALENDAR_VIEW\]([\s\S]*?)\[\/CALENDAR_VIEW\]/);
    if (calMatch) {
      try { calendarView = JSON.parse(calMatch[1].trim()); } catch { calendarView = null; }
      // On retire le bloc (complet OU encore en streaming) du texte affiché.
      text = text
        .replace(/\[CALENDAR_VIEW\][\s\S]*?\[\/CALENDAR_VIEW\]/g, '')
        .replace(/\[CALENDAR_VIEW\][\s\S]*$/g, '')
        .trim();
    }
    // ── Blocs visuels multiples : chaque type peut apparaître plusieurs fois. ──
    // Ordre d'apparition dans le texte préservé pour l'affichage.
    type VBlock =
      | { kind: 'table'; data: TableViewData }
      | { kind: 'chart'; data: ChartViewData }
      | { kind: 'coinchart'; data: CoinChartViewData }
      | { kind: 'prediction'; data: PredictionViewData }
      | { kind: 'newspecialist'; data: NewSpecialistData }
      | { kind: 'stats'; data: StatsViewData }
      | { kind: 'cards'; data: CardViewData }
      | { kind: 'steps'; data: StepsViewData }
      | { kind: 'alert'; data: AlertViewData }
      | { kind: 'accordion'; data: AccordionViewData }
      | { kind: 'rich'; data: RichViewData }
      | { kind: 'pricing'; data: PricingViewData }
      | { kind: 'audio'; data: AudioViewData }
      | { kind: 'map'; data: MapViewData }
      | { kind: 'message'; data: MessageViewData }
      | { kind: 'social'; data: SocialViewData }
      | { kind: 'contact'; data: ContactViewData }
      | { kind: 'review'; data: ReviewViewData }
      | { kind: 'plan'; data: PlanViewData };
    const blocks: { pos: number; block: VBlock }[] = [];
    const BLOCK_TAGS: { tag: string; kind: VBlock['kind'] }[] = [
      { tag: 'TABLE_VIEW', kind: 'table' },
      { tag: 'CHART_VIEW', kind: 'chart' },
      { tag: 'COIN_CHART_VIEW', kind: 'coinchart' },
      { tag: 'PREDICTION_VIEW', kind: 'prediction' },
      { tag: 'NEW_SPECIALIST', kind: 'newspecialist' },
      { tag: 'STATS_VIEW', kind: 'stats' },
      { tag: 'CARD_VIEW', kind: 'cards' },
      { tag: 'STEPS_VIEW', kind: 'steps' },
      { tag: 'ALERT_VIEW', kind: 'alert' },
      { tag: 'ACCORDION_VIEW', kind: 'accordion' },
      { tag: 'RICH_VIEW', kind: 'rich' },
      { tag: 'PRICING_VIEW', kind: 'pricing' },
      { tag: 'AUDIO_VIEW', kind: 'audio' },
      { tag: 'MAP_VIEW', kind: 'map' },
      { tag: 'MESSAGE_VIEW', kind: 'message' },
      { tag: 'SOCIAL_VIEW', kind: 'social' },
      { tag: 'CONTACT_VIEW', kind: 'contact' },
      { tag: 'REVIEW_VIEW', kind: 'review' },
      { tag: 'PLAN_VIEW', kind: 'plan' },
    ];
    for (const { tag, kind } of BLOCK_TAGS) {
      if (!text.includes(`[${tag}]`)) continue;
      const re = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        try { blocks.push({ pos: m.index, block: { kind, data: JSON.parse(m[1].trim()) } as VBlock }); } catch { /* incomplet/invalide */ }
      }
      // Retire les blocs (complets OU encore en streaming) du texte affiché.
      text = text
        .replace(new RegExp(`\\[${tag}\\][\\s\\S]*?\\[\\/${tag}\\]`, 'g'), '')
        .replace(new RegExp(`\\[${tag}\\][\\s\\S]*`, 'g'), '')
        .trim();
    }
    blocks.sort((a, b) => a.pos - b.pos);

    if (!text && !calendarView && blocks.length === 0) return null;
    if (calendarView || blocks.length > 0) {
      const textPart = text ? renderContent(text) : null;
      return (
        <>
          {textPart}
          {calendarView && <CalendarView data={calendarView} />}
          {blocks.map(({ block }, i) => {
            switch (block.kind) {
              case 'table': return <TableView key={i} data={block.data} />;
              case 'chart': return <ChartView key={i} data={block.data} />;
              case 'coinchart': return <CoinChartView key={i} data={block.data} />;
              case 'prediction': return <PredictionView key={i} data={block.data} />;
              case 'newspecialist': return <NewSpecialistCard key={i} data={block.data} />;
              case 'stats': return <StatsView key={i} data={block.data} />;
              case 'cards': return <CardView key={i} data={block.data} />;
              case 'steps': return <StepsView key={i} data={block.data} />;
              case 'alert': return <AlertView key={i} data={block.data} />;
              case 'accordion': return <AccordionView key={i} data={block.data} />;
              case 'rich': return <RichView key={i} data={block.data} />;
              case 'pricing': return <PricingView key={i} data={block.data} />;
              case 'audio': return <AudioView key={i} data={block.data} />;
              case 'map': return <MapView key={i} data={block.data} />;
              case 'message': return <MessagePreview key={i} data={block.data} />;
              case 'social': return <SocialPreview key={i} data={block.data} />;
              case 'contact': return <ContactView key={i} data={block.data} />;
              case 'review': return <ReviewView key={i} data={block.data} />;
              case 'plan': return <PlanView key={i} data={block.data} companyId={projectId} />;
              default: return null;
            }
          })}
        </>
      );
    }
    if (!text) return null;

    // Extract [FILE:path|label] tags — render downloadable file chips below text
    const fileMatches = text.match(/\[FILE:[^\]]+\]/g);
    // Extract [IMG:url] tags — render images below text
    const imgMatches = text.match(/\[IMG:(https?:\/\/[^\]]+)\]/g);
    // Extract [VIDEO:url] tags — render inline video players below text
    const videoMatches = text.match(/\[VIDEO:(https?:\/\/[^\]]+)\]/g);
    // Extract [AUDIO:url] tags — render custom voice/audio players below text
    const audioMatches = text.match(/\[AUDIO:(https?:\/\/[^\]]+)\]/g);
    const cleanText = text
      .replace(/\[FILE:[^\]]+\]/g, '')
      .replace(/\[IMG:https?:\/\/[^\]]+\]/g, '')
      .replace(/\[VIDEO:https?:\/\/[^\]]+\]/g, '')
      .replace(/\[AUDIO:https?:\/\/[^\]]+\]/g, '')
      .trim();

    // Parse text into rich elements: markdown tables → TableView, markdown
    // links → LinkPreview, bare URLs → LinkPreview, bold, plain text
    const textParts = cleanText ? renderTextWithTables(cleanText) : null;

    // Bouton « Ajouter ce spécialiste » (rendu sous le texte du message gaté).
    const specialistBtn = addSpecialist ? (
      <button
        key="add-specialist"
        onClick={() => addSpecialistAndResend(addSpecialist!.id)}
        className="mt-3 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02] active:scale-100"
        style={{ background: 'linear-gradient(135deg, #7c3aed, #f97316)' }}
      >
        <span style={{ fontSize: '1.05em', lineHeight: 1 }}>＋</span>
        Ajouter le {addSpecialist.label}
      </button>
    ) : null;

    if (!imgMatches && !fileMatches && !videoMatches) {
      if (specialistBtn) return <>{textParts}{specialistBtn}</>;
      return textParts;
    }

    const dlToken = localStorage.getItem('velbaz_token') || '';
    const fileChips = fileMatches?.map((tag, i) => {
      const inner = tag.slice(6, -1); // strip [FILE: and ]
      const sep = inner.indexOf('|');
      const path = (sep === -1 ? inner : inner.slice(0, sep)).trim();
      const label = (sep === -1 ? path.split('/').pop() : inner.slice(sep + 1)).trim() || 'document';
      if (!path || !projectId) return null;
      const href = `/api/companies/${projectId}/file-download?path=${encodeURIComponent(path)}&token=${encodeURIComponent(dlToken)}`;
      return (
        <a
          key={`file-${i}`}
          href={href}
          download={label}
          className="inline-block mt-1 mr-3 no-underline hover:underline"
          style={{ color: 'var(--accent, #5B4BFF)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
          title={`Download ${label}`}
        >
          {label}
        </a>
      );
    }).filter(Boolean);

    return (
      <>
        {textParts}
        {fileChips && fileChips.length > 0 && (
          <div className="flex flex-col items-start mt-1">{fileChips}</div>
        )}
        {imgMatches?.map((tag, i) => {
          const url = tag.match(/\[IMG:(https?:\/\/[^\]]+)\]/)?.[1];
          if (!url) return null;
          return (
            <div key={`img-${i}`} className="mt-2 page-preview-enter">
              <img
                src={url}
                alt="Generated product"
                className="rounded-xl"
                style={{ maxWidth: 400, maxHeight: 300, objectFit: 'cover', border: '1px solid var(--border-default)', boxShadow: '0 2px 12px rgba(0,0,0,0.1)' }}
              />
            </div>
          );
        })}
        {videoMatches?.map((tag, i) => {
          const url = tag.match(/\[VIDEO:(https?:\/\/[^\]]+)\]/)?.[1];
          if (!url) return null;
          return (
            <div key={`vid-${i}`} className="mt-2 page-preview-enter">
              <video
                src={url}
                controls
                playsInline
                className="rounded-xl"
                style={{ maxWidth: 420, maxHeight: 420, width: '100%', background: '#000', border: '1px solid var(--border-default)', boxShadow: '0 2px 12px rgba(0,0,0,0.1)' }}
              />
              <div className="mt-1">
                <button type="button" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                  className="text-[12px] no-underline hover:underline"
                  style={{ color: 'var(--accent, #6C5BFF)', fontWeight: 500, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>Download video</button>
              </div>
            </div>
          );
        })}
        {audioMatches?.map((tag, i) => {
          const url = tag.match(/\[AUDIO:(https?:\/\/[^\]]+)\]/)?.[1];
          if (!url) return null;
          return (
            <div key={`aud-${i}`} className="mt-2 page-preview-enter">
              <AudioView data={{ url }} />
            </div>
          );
        })}
      </>
    );
  }
  /** Détecte les tableaux Markdown en pipes ( | col | col | + ligne :--- )
   *  et les rend via le composant TableView (variant éditorial, épuré).
   *  Le reste du texte passe par parseRichText normalement. Garantit qu'un
   *  tableau « | … | » émis par l'IA s'affiche joliment au lieu de montrer
   *  les pipes en texte brut. */
  function renderTextWithTables(text: string): React.ReactNode[] {
    const lines = text.split('\n');
    const out: React.ReactNode[] = [];
    let buf: string[] = [];
    let key = 0;

    const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
    // Ligne séparatrice : uniquement des tirets/deux-points/pipes/espaces, avec au moins un tiret.
    const isSep = (l: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(l) && l.includes('-') && !/[a-zA-Z0-9]/.test(l);

    const splitCells = (l: string) => {
      let s = l.trim();
      if (s.startsWith('|')) s = s.slice(1);
      if (s.endsWith('|')) s = s.slice(0, -1);
      return s.split('|').map((c) => c.trim());
    };

    const flushText = () => {
      if (buf.length === 0) return;
      const t = buf.join('\n').replace(/^\n+|\n+$/g, '');
      if (t.trim()) out.push(<span key={`tx-${key++}`}>{parseRichText(t)}</span>);
      buf = [];
    };

    for (let i = 0; i < lines.length; i++) {
      // Un tableau = ligne d'en-tête + ligne séparatrice + >=1 ligne(s) de données.
      if (isRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1])) {
        const header = splitCells(lines[i]);
        let j = i + 2;
        const bodyRows: string[][] = [];
        while (j < lines.length && isRow(lines[j]) && !isSep(lines[j])) {
          bodyRows.push(splitCells(lines[j]));
          j++;
        }
        if (bodyRows.length > 0) {
          flushText();
          const columns = header.map((h, ci) => ({ key: `c${ci}`, label: h, align: 'left' as const }));
          const rows = bodyRows.map((r) => {
            const obj: Record<string, any> = {};
            header.forEach((_, ci) => { obj[`c${ci}`] = r[ci] ?? ''; });
            return obj;
          });
          out.push(<TableView key={`tbl-${key++}`} data={{ variant: 'bordered', columns, rows }} />);
          i = j - 1;
          continue;
        }
      }
      buf.push(lines[i]);
    }
    flushText();
    return out;
  }

  function parseRichText(text: string): React.ReactNode[] {
    // Split on markdown links [text](url), hex colors, AND bare URLs
    const TOKEN_RE = /(\[.*?\]\(.*?\))|(#[0-9a-fA-F]{6}\b)|(https?:\/\/[^\s),;!?\]]+)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let keyIdx = 0;

    let match: RegExpExecArray | null;
    while ((match = TOKEN_RE.exec(text)) !== null) {
      // Push plain text before this match (with bold parsing)
      if (match.index > lastIndex) {
        parts.push(...parseBold(text.slice(lastIndex, match.index), keyIdx));
        keyIdx += 10;
      }

      if (match[1]) {
        // Markdown link: [label](url)
        const linkMatch = match[1].match(/\[(.*?)\]\((.*?)\)/);
        if (linkMatch) {
          const label = linkMatch[1];
          const url = linkMatch[2];
          parts.push(
            <LinkPreview key={`lp-${keyIdx++}`} url={url}>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer', borderBottom: '1px dashed var(--text-ghost)', paddingBottom: 1 }}>
                {label}
              </span>
            </LinkPreview>
          );
        }
      } else if (match[2]) {
        // Hex color code — render with ColorPreview swatch
        const hex = match[2];
        parts.push(
          <ColorPreview key={`cp-${keyIdx++}`} color={hex}>
            {hex.toUpperCase()}
          </ColorPreview>
        );
      } else if (match[3]) {
        // Bare URL
        const url = match[3];
        let domain = '';
        try { domain = new URL(url).hostname.replace('www.', ''); } catch { domain = url; }
        parts.push(
          <LinkPreview key={`lp-${keyIdx++}`} url={url}>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer', borderBottom: '1px dashed var(--text-ghost)', paddingBottom: 1 }}>
              {domain}
            </span>
          </LinkPreview>
        );
      }

      lastIndex = match.index + match[0].length;
    }

    // Push remaining text
    if (lastIndex < text.length) {
      parts.push(...parseBold(text.slice(lastIndex), keyIdx));
    }

    return parts;
  }

  /** Parse ==highlight== markers and **bold** segments in plain text */
  function parseBold(text: string, baseKey: number): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    // Match a highlight token ==text== / ==color|text== OR a **bold** span.
    const RE = /(==(?:[a-zA-Z]+\|)?[^=\n]+==)|(\*\*.*?\*\*)/g;
    let last = 0;
    let j = 0;
    let m: RegExpExecArray | null;
    while ((m = RE.exec(text)) !== null) {
      if (m.index > last) nodes.push(<span key={`t-${baseKey}-${j++}`}>{text.slice(last, m.index)}</span>);
      if (m[1]) {
        nodes.push(renderHighlight(m[1], `hl-${baseKey}-${j++}`));
      } else if (m[2]) {
        nodes.push(<strong key={`b-${baseKey}-${j++}`} style={{ color: 'var(--text-secondary)' }}>{m[2].slice(2, -2)}</strong>);
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) nodes.push(<span key={`t-${baseKey}-${j++}`}>{text.slice(last)}</span>);
    return nodes;
  }

  const buildSteps = useMemo(() => {
    // Once a file has a [CODE_DONE], drop its earlier [CODE_START] placeholder so
    // history shows a single finished code panel per file instead of two rows.
    const collapseCodePairs = (steps: Message[]): Message[] => {
      const doneFiles = new Set<string>();
      for (const s of steps) {
        const m = s.content?.match(/\[CODE_(?:DONE|EDIT):([^:\]]+):/);
        if (m) doneFiles.add(m[1]);
      }
      return steps.filter(s => {
        const m = s.content?.match(/\[CODE_START:([^\]]+)\]/);
        return !(m && doneFiles.has(m[1]));
      });
    };
    // Collapse executing/completed activity pairs. Each agent task emits an
    // "executing" step (message = title) and a "completed" step (message =
    // "✓ title"); once the ✅/✓ is stripped for display they render as identical
    // text, showing the same line twice. Keep only the LAST occurrence of each
    // cleaned text so the finished (checkmarked) step wins. Skip code steps —
    // those are handled by collapseCodePairs above.
    const collapseActivityPairs = (steps: Message[]): Message[] => {
      const lastIndexByText = new Map<string, number>();
      steps.forEach((s, i) => {
        if (parseCodeBlock(s.content)) return;
        const key = cleanStepText(s.content || '');
        if (key) lastIndexByText.set(key, i);
      });
      return steps.filter((s, i) => {
        if (parseCodeBlock(s.content)) return true;
        const key = cleanStepText(s.content || '');
        if (!key) return true;
        return lastIndexByText.get(key) === i;
      });
    };
    // Always merge historical build steps from messages with live build messages
    // This ensures steps are visible even during the async gap when isBuildingThis
    // transitions from false→true (e.g. after navigation, resumeBuild is async)
    const liveBuildSteps = build.buildMessages.filter(m => m.isBuildStep);
    const historicalBuildSteps = messages.filter(m => (m as any).isBuildStep);
    
    if (liveBuildSteps.length > 0 || isBuildingThis) {
      // Deduplicate: prefer live steps, add historical ones that aren't covered
      const liveIds = new Set(liveBuildSteps.map(m => m.id));
      const liveContents = new Set(liveBuildSteps.map(m => m.content?.slice(0, 80)));
      const unique = historicalBuildSteps.filter(m => !liveIds.has(m.id) && !liveContents.has(m.content?.slice(0, 80)));
      const merged = [...unique, ...liveBuildSteps].sort((a, b) => a.time.getTime() - b.time.getTime());
      return collapseActivityPairs(collapseCodePairs(merged.length > 0 ? merged : historicalBuildSteps));
    }
    // Not building and no live steps — show historical build steps from messages (loaded from activity)
    return collapseActivityPairs(collapseCodePairs(allMessages.filter(m => (m as any).isBuildStep)));
  }, [isBuildingThis, build.buildMessages, allMessages, messages]);

  const lastBuildStep = buildSteps[buildSteps.length - 1] ?? null;
  const [buildHistoryOpen, setBuildHistoryOpen] = useState(true);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  // ── Logo extraction from build steps ──
  const logoInfo = useMemo(() => {
    // Find logo-related messages
    const logoGenerating = buildSteps.find(s => s.content?.includes('Generating logo'));
    const logoDone = buildSteps.find(s => s.content?.includes('Logo created') || s.content?.includes('Logo saved'));
    // Extract URL from [IMG:url] tag
    let logoUrl: string | null = null;
    if (logoDone) {
      const match = logoDone.content.match(/\[IMG:(https?:\/\/[^\]]+)\]/);
      if (match) logoUrl = match[1];
    }
    const isGenerating = !!logoGenerating && !logoDone;
    return { logoUrl, isGenerating, hasLogo: !!logoDone };
  }, [buildSteps]);

  // ── AI Approval detection ──
  const prevBuildStepCountRef = useRef(0);
  useEffect(() => {
    if (!isBuildingThis || !isAIApprovalEnabled()) {
      prevBuildStepCountRef.current = buildSteps.length;
      return;
    }
    // Detect new executing steps
    const prevCount = prevBuildStepCountRef.current;
    if (buildSteps.length > prevCount) {
      const newSteps = buildSteps.slice(prevCount);
      // Find the last 'executing' type step (has "working on" in reasoning)
      const executingStep = newSteps.find(s =>
        s.reasoning?.includes('working on') &&
        !s.content?.includes('✓') &&
        !s.content?.includes('✅') &&
        !s.content?.includes('✗')
      );
      if (executingStep) {
        // Extract agent role from reasoning
        const roleMatch = executingStep.reasoning?.match(/^(.*?)\s+is working/);
        const role = (roleMatch ? roleMatch[1] : 'Agent') || 'Agent';
        setPendingApproval({
          decision: executingStep.content || '',
          agentRole: role.toLowerCase().replace(/\s+agent$/i, '').replace(/\s+/g, '_'),
          approvalId: executingStep.id,
        });
      }
    }
    prevBuildStepCountRef.current = buildSteps.length;
  }, [buildSteps, isBuildingThis]);

  const isEditingThis = editSteps.length > 0 && chatLoading;
  const isWorking = chatLoading || isBuildingThis;
  const showCancel = isWorking;

  // L'IA analyse-t-elle une image ? Vrai si le dernier message utilisateur
  // contient une pièce jointe image (previewUrl) — on montre alors l'animation
  // "Analysis de l'image" au lieu de l'indicateur de réflexion générique.
  const lastUserMsgHasImage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return !!messages[i].attachments?.some(a => !!a.previewUrl);
      }
    }
    return false;
  }, [messages]);

  const effectiveShowPreview = showPreview && !panelCollapsed;
  // La preview gagne toujours : le panneau de tasks IA n'apparaît que si aucune preview n'est affichée.
  const showAutoPanel = autoMode && !!projectId && !effectiveShowPreview;
  const rightPanelOpen = effectiveShowPreview || showAutoPanel;

  // Zone Téléphone : la preview mobile vit HORS du rectangle scalable — panneau
  // à largeur FIXE (pas de poignée de redimensionnement), et les boutons
  // Web/Téléphone restent dans la barre d'outils au-dessus, jamais dans le rectangle.
  const phoneZone = effectiveShowPreview && build.websiteReady && !!projectId && !showSocialPanel
    && panelMode === 'preview'
    && (projectType === 'mobile' || (projectType === 'both' && previewDevice === 'phone'));

  return (
    <div
      ref={containerRef}
      className="h-full flex overflow-hidden relative"
      style={{
        background: 'var(--surface-0)',
        // Le panneau de droite POUSSE le contenu au lieu de passer par-dessus.
        paddingRight: !isMobile && user && leftBarOpen ? 280 : 0,
        transition: 'padding-right 0.38s cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >

      {/* ─── Left: Chat Panel ─── */}
      <div
        className="flex flex-col overflow-hidden"
        style={{
          width: effectiveShowPreview ? (phoneZone ? 'auto' : `${100 - previewWidth}%`) : (showAutoPanel ? 'auto' : '100%'),
          flex: (effectiveShowPreview && phoneZone) || showAutoPanel ? 1 : undefined,
          minWidth: 300,
          transition: isDraggingState ? 'none' : 'width 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* Project Tabs (Chat / Dashboard) — inside chat panel so preview gets full height */}
        {projectId && (
          <div className="px-5 pt-3 pb-1 shrink-0" style={{ position: 'relative', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <ProjectTabs projectId={projectId} active="chat" />
          </div>
        )}
        <div ref={scrollContainerRef} onScroll={handleMessagesScroll} className="flex-1 overflow-y-auto px-6 py-6">
          <div className={`space-y-4 mx-auto ${effectiveShowPreview ? 'max-w-xl' : 'max-w-2xl'}`}>

            {loadingHistory && (
              <div className="flex items-center justify-center gap-1.5" style={{ height: 'calc(100vh - 200px)' }}>
                <div className="typing-dot" />
                <div className="typing-dot" />
                <div className="typing-dot" />
              </div>
            )}

            {!loadingHistory && allMessages.length === 0 && !isWorking && (
              <div className="flex flex-col items-center justify-center h-64 gap-3">
                <VelbazIcon state="idle" size={36} />
                <p className="text-[14px]" style={{ color: 'var(--text-ghost)' }}>Start a conversation with {BRAND}</p>
              </div>
            )}

            {(() => {
              // Group consecutive build steps into collapsible blocks
              // Always group them — both during active build AND after build completes
              const groups: { type: 'msg'; msg: typeof allMessages[0] }[] | { type: 'build'; msgs: typeof allMessages }[] = [];
              let buildBatch: typeof allMessages = [];
              for (const msg of allMessages) {
                if (msg.isBuildStep) {
                  buildBatch.push(msg);
                } else {
                  if (buildBatch.length > 0) {
                    (groups as any[]).push({ type: 'build', msgs: [...buildBatch] });
                    buildBatch = [];
                  }
                  (groups as any[]).push({ type: 'msg', msg });
                }
              }
              if (buildBatch.length > 0) (groups as any[]).push({ type: 'build', msgs: [...buildBatch] });
              // Zip les checkpoints (ordre chronologique) aux groupes de build
              // terminés, en alignant depuis la FIN (le dernier build = le
              // dernier checkpoint) pour rester robuste si un build ancien
              // n'avait pas de checkpoint.
              const buildGroupTotal = (groups as any[]).filter((g: any) => g.type === 'build').length;
              const cpForBuild = checkpoints.slice(Math.max(0, checkpoints.length - buildGroupTotal));
              // Index du DERNIER groupe de build — seul celui-ci doit passer en
              // mode "live" (liste de tasks) quand un build/édition est en
              // cours. Les groupes de build précédents sont déjà terminés et
              // doivent garder leur WorkResultCard (rectangle preview) visible,
              // sinon le rectangle disparaît à chaque nouveau travail lancé.
              let lastBuildGroupIndex = -1;
              (groups as any[]).forEach((g: any, i: number) => { if (g.type === 'build') lastBuildGroupIndex = i; });
              let buildSeen = 0;
              return (groups as any[]).map((g: any, gi: number) => {
                if (g.type === 'build') {
                  const steps = g.msgs as typeof allMessages;
                  if ((isBuildingThis || isEditingThis) && gi === lastBuildGroupIndex) {
                    // Build/édition en cours : liste COMPLÈTE des tasks en direct
                    // dans le chat (groupes de tasks, étape active en shimmer),
                    // comme avant — l'utilisateur voit tout ce que l'IA fait.
                    const liveLastId = isEditingThis ? editSteps[editSteps.length - 1]?.id : lastBuildStep?.id;
                    const taskGroups = groupBuildStepsByTask(steps, liveLastId);
                    return (
                      <div key={`build-live-${gi}`} className="w-full my-2 space-y-0.5">
                        {taskGroups.map((group, i) => (
                          <TaskGroupRow key={`${group.type}-${i}`} group={group} defaultExpanded />
                        ))}
                      </div>
                    );
                  }
                  // Completed build: show collapsed history
                  const completedSteps = steps.filter((s: any) => s.content?.includes('✅') || s.content?.includes('✓'));
                  const summary = completedSteps.length > 0
                    ? `${completedSteps.length} tasks completed`
                    : `${steps.length} build steps`;
                  const cpIndex = buildSeen;
                  const cp = cpForBuild[cpIndex];
                  buildSeen++;
                  const isLatestCp = cpIndex === cpForBuild.length - 1;
                  const isPhoneCard = projectType === 'mobile';
                  return (
                    <div key={`build-group-${gi}`}>
                      <BuildHistoryBlock steps={steps} summary={summary} />
                      {cp && (
                        <WorkResultCard
                          companyId={projectId!}
                          isPhone={isPhoneCard}
                          checkpoint={cp}
                          isLatest={isLatestCp}
                          onForked={handleForked}
                          onRolledBack={handleRolledBack}
                          onOpenPreview={() => {
                            setPanelMode('preview');
                            setPanelCollapsed(false);
                            setPreviewWidth(58);
                          }}
                        />
                      )}
                    </div>
                  );
                }
                const msg = g.msg as typeof allMessages[0];
              return (
                <div key={msg.id}>
                  {msg.role === 'assistant' ? (
                    msg.teamMsgs && msg.teamMsgs.length > 0 ? (
                      <div className="pl-7">
                        <TeamConversation msgs={msg.teamMsgs} />
                      </div>
                    ) : (
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <VelbazIcon state="idle" size={22} />
                        
                        
                      </div>
                      <div className="pl-7 text-[14px] leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-muted)' }}>
                        {renderContent(msg.content)}
                      </div>
                    </div>
                    )
                  ) : (
                    <div className="flex flex-col items-end gap-1.5">
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="flex flex-wrap justify-end gap-1.5 max-w-[80%]">
                          {msg.attachments.map((att, i) => {
                            const isImg = !!att.previewUrl;
                            const ext = att.name.split('.').pop()?.toLowerCase() || '';
                            const isCode = ['js','ts','jsx','tsx','py','rb','go','rs','java','c','cpp','h','php','cs','swift','kt'].includes(ext);
                            const isData = ['json','yaml','yml','xml'].includes(ext);
                            return (
                              <AttachmentChip
                                key={i}
                                name={att.name}
                                isImage={isImg}
                                previewUrl={att.previewUrl}
                                iconType={isImg ? 'image' : isCode ? 'code' : isData ? 'data' : 'text'}
                              />
                            );
                          })}
                        </div>
                      )}
                      <div className="group/msg relative max-w-[80%]">
                        <div className="px-4 py-2.5 rounded-2xl rounded-br-md text-[14px] leading-relaxed" style={{ background: 'var(--surface-4)', color: 'var(--text-secondary)' }}>
                          {msg.content}
                        </div>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(msg.content).then(() => {
                              setCopiedMsgId(msg.id);
                              setTimeout(() => setCopiedMsgId(null), 1500);
                            });
                          }}
                          className="absolute -bottom-5 right-0 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-150 p-0.5 rounded-md hover:bg-[var(--surface-3)]"
                          title="Copy message"
                        >
                          {copiedMsgId === msg.id ? (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          ) : (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
              });
            })()}

            {streamingContent && (
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <VelbazIcon state="thinking" size={22} />
                  <span className="an-think-shimmer text-[13px] font-medium">{BRAND} is responding</span>
                </div>
                <div className="pl-7 text-[14px] leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-muted)' }}>
                  {renderContent(streamingContent)}
                  <span className="inline-block w-[2px] h-[16px] ml-0.5 animate-pulse" style={{ background: 'var(--blue-accent)', verticalAlign: 'text-bottom' }} />
                </div>
              </div>
            )}

            {chatLoading && !streamingContent && !isBuildingThis && liveTeamMsgs.length === 0 && (
              lastUserMsgHasImage && !siteEditLoading
                ? <AnalyzingImageIndicator />
                : <>
                    <ThinkingIndicator label={siteEditLoading ? (isReactProjectChat ? "I'm editing your app" : "I'm editing your site") : undefined} steps={siteEditLoading ? undefined : liveProgress} />
                    {liveCamera && <LiveCamera feed={liveCamera} />}
                  </>
            )}

            {/* ── Préparation live : ce que l'IA fait AVANT le build (temps réel) ──
                 Pas d'icône Velbaz animée ici : dès qu'une task "working" avec
                 son détail est affichée, seule la liste de tasks doit être
                 visible (l'animation ne sert que pour l'attente "vide"). */}
            {prepSteps && prepSteps.length > 0 && (
              <div className={`flex items-start gap-2 mb-4 mr-auto ${effectiveShowPreview ? 'max-w-xl' : 'max-w-2xl'}`}>
                <div className="flex-1 pt-0.5 text-[13px] leading-relaxed">
                  {prepSteps.map(s => (
                    <div key={s.id} style={{ color: s.status === 'running' ? 'var(--text-primary)' : 'var(--text-secondary)', opacity: s.status === 'done' ? 0.7 : 1 }}>
                      {s.status === 'done' ? 'Done: ' : s.status === 'error' ? 'Error: ' : 'In progress: '}
                      {s.label}
                      {s.detail && <span style={{ color: 'var(--text-dim)' }}> — {s.detail}</span>}
                      {s.status === 'running' && <span className="animate-pulse">…</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Moteur /genesis : suivi des 8 phases de raisonnement ── */}
            {genesisRun && (
              <div className="mx-auto max-w-2xl w-full mb-4">
                <GenesisPanel run={genesisRun} />
              </div>
            )}

            {/* ── Porte de choix : l'utilisateur clique la proposition qu'il préfère ── */}
            {genesisRun?.choice && (
              <div className="mx-auto max-w-2xl w-full mb-4 rounded-2xl p-4"
                   style={{ background: 'var(--surface-1, rgba(255,255,255,0.04))', border: '1px solid var(--border, rgba(255,255,255,0.10))' }}>
                <p className="text-[13px] mb-3" style={{ color: 'var(--text-dim)' }}>{genesisRun.choice.question}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {genesisRun.choice.options.map((opt, i) => (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={genesisChoiceBusy}
                      onClick={() => sendGenesisChoice(genesisRun!.choice!.runId, { pick: opt.id })}
                      className="group relative block w-full overflow-hidden rounded-xl text-left transition-transform duration-200 hover:-translate-y-0.5 disabled:opacity-50"
                      style={{ border: '1px solid var(--border, rgba(255,255,255,0.12))' }}
                    >
                      <img src={opt.url} alt={opt.label} className="block w-full h-auto" />
                      <span className="absolute left-2 top-2 rounded-md px-2 py-0.5 text-[11px] font-medium"
                            style={{ background: 'rgba(0,0,0,0.65)', color: '#fff' }}>
                        {i + 1}
                      </span>
                      <span className="absolute inset-0 flex items-end justify-center pb-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent 55%)' }}>
                        <span className="text-[12px] font-medium" style={{ color: '#fff' }}>Choisir celle-ci</span>
                      </span>
                    </button>
                  ))}
                </div>
                {genesisRun.choice.canAskMore && (
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      value={genesisChoiceText}
                      onChange={(e) => setGenesisChoiceText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && genesisChoiceText.trim() && !genesisChoiceBusy) {
                          sendGenesisChoice(genesisRun!.choice!.runId, { prompt: genesisChoiceText.trim() });
                        }
                      }}
                      placeholder="Aucune ne te plaît ? Dis-moi ce que tu veux voir à la place…"
                      className="flex-1 rounded-lg px-3 py-2 text-[13px] outline-none"
                      style={{ background: 'var(--surface-2, rgba(255,255,255,0.06))', border: '1px solid var(--border, rgba(255,255,255,0.10))', color: 'var(--text)' }}
                    />
                    <button
                      type="button"
                      disabled={genesisChoiceBusy || !genesisChoiceText.trim()}
                      onClick={() => sendGenesisChoice(genesisRun!.choice!.runId, { prompt: genesisChoiceText.trim() })}
                      className="rounded-lg px-3 py-2 text-[13px] font-medium disabled:opacity-40"
                      style={{ background: 'var(--accent, #fff)', color: 'var(--accent-fg, #000)' }}
                    >
                      Autre planche
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── Page-plan loading ── */}
            {planningPages && !prepSteps && (
              <div className={`flex items-start gap-2 mb-4 mr-auto ${effectiveShowPreview ? 'max-w-xl' : 'max-w-2xl'}`}>
                <VelbazIcon state="thinking" size={22} />
                <div className="flex-1 pt-1">
                  <span className="text-[12px] font-medium" style={{ color: 'var(--text-dim)' }}>I'm preparing the page plan for your site...</span>
                </div>
              </div>
            )}

            {/* ── Type de projet : web / mobile / les deux (idée ambiguë) ── */}
            {pendingTypeChoice && (
              <div className="mb-2">
                <QuestionTool
                  questions={[{
                    q: 'Do you want a website, a real mobile app, or both?',
                    kind: 'single',
                    options: [
                      { id: 'web', label: '🌐 Website', description: 'A classic website / web app, accessible from a browser.' },
                      { id: 'mobile', label: '📱 Mobile app', description: 'A real iOS/Android app (or game), testable on your phone via a QR code.' },
                      { id: 'both', label: '🌐 + 📱 Both', description: 'The website THEN the mobile app, in the same build (~2× more tokens).' },
                    ],
                  }]}
                  questionIndex={0}
                  onAnswer={(_idx, answer) => confirmProjectType(answer)}
                  onSkip={() => confirmProjectType('web')}
                  onFinish={() => confirmProjectType('web')}
                />
              </div>
            )}

            {/* ── Page-selection (affiché comme une question, comme les autres) ── */}
            {pendingPagePlan && (
              <div className="mb-2">
                <PagePlanTool
                  title="Here are the pages I will create for your site. Edit, delete, or add as many as you want."
                  hint="Standard pages (login, settings, legal notices…) are added automatically."
                  initialPages={pendingPagePlan.pages.map((p) => ({
                    name: String(p.name),
                    purpose: p.purpose ? String(p.purpose) : undefined,
                  }))}
                  onConfirm={(chosen) => confirmPagesList(chosen)}
                  onSkip={() => skipPageSelection()}
                />
              </div>
            )}

            {/* ─── IA — Preview de marque avant build (brand_preview) ───
                Rendu DANS le flux scrollable (juste au-dessus de la barre de
                prompt), pour que la page reste scrollable et qu'aucune zone
                morte n'apparaisse sur les côtés du rectangle. */}
            {pendingBrandBuild
              && (!projectId || pendingBrandBuild.companyId === projectId
                  || pendingBrandBuild.companyId === precreatedCompanyRef.current?.id) && (
              <div className="mx-auto max-w-2xl w-full">
                <BrandPreviewPopup
                  companyId={pendingBrandBuild.companyId}
                  onApproved={() => {
                    brandGateDoneRef.current = true;
                    try { localStorage.removeItem(`velbaz_brand_gate_${pendingBrandBuild.companyId}`); } catch {}
                    setPendingBrandBuild(null);
                    const run = brandBuildRunRef.current;
                    brandBuildRunRef.current = null;
                    if (run) run();
                  }}
                  onDismiss={() => {
                    try { localStorage.removeItem(`velbaz_brand_gate_${pendingBrandBuild.companyId}`); } catch {}
                    setPendingBrandBuild(null);
                    brandBuildRunRef.current = null;
                    setChatLoading(false);
                  }}
                />
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input bar */}
        <div className="px-6 pb-5 pt-2 shrink-0">
          <div className={`relative mx-auto ${effectiveShowPreview ? 'max-w-xl' : 'max-w-2xl'}`}>

            {/* ─── Agent Running Block (shown when AI is building) ─── */}
            {isBuildingThis && lastBuildStep?.reasoning && (
              <div key={`r-${lastBuildStep.id}`} className="build-live-reasoning-enter text-left mb-2 px-4">
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--border-hover)' }}>{lastBuildStep.reasoning}</p>
              </div>
            )}

            {/* ─── AI Approval Popup ─── */}
            {pendingApproval && (
              <AIApprovalPopup
                decision={pendingApproval.decision}
                agentRole={pendingApproval.agentRole}
                onAccept={() => {
                  setPendingApproval(null);
                }}
                onDecline={(reason) => {
                  // Add the decline reason as a user message so the AI sees it
                  const declineMsg: Message = {
                    id: `decline-${Date.now()}`,
                    role: 'user',
                    content: `[AI Decision Declined] I don't want this: "${pendingApproval.decision}". Instead: ${reason}`,
                    time: new Date(),
                  };
                  setMessages(prev => [...prev, declineMsg]);
                  if (projectId) {
                    api.chat.save({ sessionId: projectId, role: 'user', content: declineMsg.content }).catch(() => {});
                  }
                  setPendingApproval(null);
                }}
              />
            )}

            {/* ─── IA — Visualiseur produit (product_preview) ─── */}
            {pendingPopup && pendingPopup.type === 'product_preview' && projectId && (
              <ProductVisualizerPopup
                companyId={projectId}
                description={pendingPopup.description || pendingPopup.message || ''}
                title={pendingPopup.title}
                message={pendingPopup.message}
                onRespond={(response) => {
                  setPendingPopup(null);
                  setTimeout(() => doSend(response), 50);
                }}
                onDismiss={() => setPendingPopup(null)}
              />
            )}

            {/* ─── IA — Inventeur (invention_preview) ─── */}
            {pendingPopup && pendingPopup.type === 'invention_preview' && projectId && (
              <InventionVisualizerPopup
                companyId={projectId}
                description={pendingPopup.description || pendingPopup.message || ''}
                title={pendingPopup.title}
                message={pendingPopup.message}
                onRespond={(response) => {
                  setPendingPopup(null);
                  setTimeout(() => doSend(response), 50);
                }}
                onDismiss={() => setPendingPopup(null)}
              />
            )}

            {/* ─── AI-triggered Popup (confirm/preview/choice/alert/progress/secret/recap/info) ─── */}
            {pendingPopup && pendingPopup.type !== 'product_preview' && pendingPopup.type !== 'invention_preview' && (
              <AIPopup
                popup={pendingPopup}
                onRespond={(response) => {
                  const p = pendingPopup;
                  setPendingPopup(null);
                  // Browsing sentinel (e.g. "upgrade" popup → /plans button):
                  // navigate in-app instead of sending a message back to the AI.
                  if (typeof response === 'string' && response.startsWith('__NAVIGATE__')) {
                    navigate(response.slice('__NAVIGATE__'.length) || '/plans');
                    return;
                  }
                  // Non-blocking popups (info) just dismiss without pinging the AI.
                  if (p && !isBlockingPopup(p.type)) {
                    // progress pause/stop DO send a response; info dismiss does not.
                    if (p.type === 'info') return;
                  }
                  setTimeout(() => doSend(response), 50);
                }}
                onDismiss={() => setPendingPopup(null)}
                onSaveSecrets={async (values) => {
                  if (!projectId) return false;
                  try { await api.companies.secrets.set(projectId, values); return true; }
                  catch { return false; }
                }}
                onDeleteSecrets={async (keys) => {
                  if (!projectId) return false;
                  try { await api.companies.secrets.delete(projectId, keys); return true; }
                  catch { return false; }
                }}
              />
            )}

            {/* ─── Question Popup ─── */}
            {pendingQuestions.length > 0 && (
              <div className="mb-2">
                <QuestionTool
                  questions={pendingQuestions}
                  questionIndex={questionIndex}
                  onAnswer={(idx, answer) => {
                    const newAnswers = { ...questionAnswers, [idx]: answer };
                    setQuestionAnswers(newAnswers);
                    if (idx < pendingQuestions.length - 1) {
                      setQuestionIndex(idx + 1);
                    } else {
                      finishQuestions(newAnswers);
                    }
                  }}
                  onSkip={(idx) => {
                    if (idx < pendingQuestions.length - 1) {
                      setQuestionIndex(idx + 1);
                    } else {
                      finishQuestions(questionAnswers);
                    }
                  }}
                  onFinish={() => finishQuestions(questionAnswers)}
                />
              </div>
            )}

            {/* ─── Input Box ─── */}
            <div className="relative">
            {/* Live voice panel — floats ABOVE the bar (outside overflow:hidden box) */}
            {isListening && <VoiceOverlay voiceBars={voiceBars} onStop={stopListening} />}

            {/* ─── Studio Media (Higgsfield) ─── */}
            <HiggsfieldStudio
              open={showMediaStudio}
              companyId={projectId ?? ''}
              sessionId={sessionId}
              onClose={() => setShowMediaStudio(false)}
              authHeaders={authHeaders}
              onLiveMessage={upsertHiggsfieldMessage}
            />

            {/* ── Pub (Higgsfield) — questions au-dessus de la barre (design QuestionTool) ── */}
            {adFlow && (() => {
              const curKey = nextAdKey(adFlow.answers);

              // Génération en cours
              if (adSubmitting) {
                return (
                  <div className="mb-2.5 rounded-[10px] border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 py-4 flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--text-dim)', borderTopColor: 'transparent' }} />
                    <span className="text-[13px]" style={{ color: 'var(--text-dim)' }}>I'm preparing your ad…</span>
                  </div>
                );
              }

              // Chargement des avatars Higgsfield
              if (curKey === 'avatar' && adAvatarsLoading) {
                return (
                  <div className="mb-2.5 rounded-[10px] border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 py-4 flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--text-dim)', borderTopColor: 'transparent' }} />
                    <span className="text-[13px]" style={{ color: 'var(--text-dim)' }}>Loading Higgsfield avatars…</span>
                  </div>
                );
              }

              if (!curKey) return null;
              const cfg = adQuestionConfig(curKey);
              return (
                <div className="mb-2.5">
                  <QuestionTool
                    questions={[cfg]}
                    questionIndex={0}
                    onAnswer={(_idx, answer) => onAdAnswer(curKey, cfg, answer)}
                    onSkip={() => onAdSkip(curKey)}
                    onFinish={() => onAdSkip(curKey)}
                  />
                </div>
              );
            })()}

            {/* ── Plan panel — rectangle above the input bar ── */}
            {(planLoading || planData) && (
              <div className="rounded-[10px] border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 overflow-hidden mb-2.5 relative">
                {/* Header bar (identique au rectangle des questions) */}
                <div className="h-8 border-b border-neutral-200 dark:border-neutral-800 px-3 flex items-center justify-between text-[13px] text-neutral-500 dark:text-neutral-400">
                  <div className="inline-flex items-center gap-1.5">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>
                    Plan
                  </div>
                  {planData && planData.steps.length > 0 && (
                    <span>{planData.steps.length} task{planData.steps.length > 1 ? 's' : ''}</span>
                  )}
                  {!planLoading && (
                    <button
                      onClick={() => { setPlanData(null); setPlanOriginalMsg(''); setPlanDetailsMode(false); setPlanForBuild(false); }}
                      className="ml-2 w-5 h-5 flex items-center justify-center rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-800"
                      title="Cancel the plan"
                    >
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    </button>
                  )}
                </div>

                {planLoading ? (
                  <div className="px-4 py-5 flex items-center gap-3 bg-white dark:bg-neutral-950">
                    <div className="w-4 h-4 rounded-full border-2 animate-spin border-neutral-400 dark:border-neutral-600" style={{ borderTopColor: 'transparent' }} />
                    <span className="text-[14px] text-neutral-500 dark:text-neutral-400">Creating the plan…</span>
                  </div>
                ) : planData && (
                  <div className="px-3 py-3 space-y-3 bg-white dark:bg-neutral-950">
                    {/* Titre + résumé */}
                    <div>
                      <h2 className="text-[16px] font-semibold leading-snug text-neutral-900 dark:text-neutral-100">{planData.title}</h2>
                      {planData.summary && <p className="text-[13.5px] mt-1 leading-relaxed text-neutral-500 dark:text-neutral-400">{planData.summary}</p>}
                    </div>

                    {/* Liste des tasks (dans l'ordre) — design du plan des pages */}
                    <div className="space-y-px max-h-[300px] overflow-y-auto -mx-1">
                      {planData.steps.map((s, i) => (
                        <div key={i} className="flex gap-2.5 items-start rounded-md px-2 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-900">
                          <span className="h-6 min-w-6 px-1 rounded-[5px] inline-flex items-center justify-center text-[13px] font-medium border bg-transparent text-neutral-500 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 mt-0.5">
                            {i + 1}
                          </span>
                          <div className="flex-1">
                            <div className="text-[14px] font-medium leading-snug text-neutral-900 dark:text-neutral-100">{s.title}</div>
                            {s.description && <div className="text-[13px] mt-0.5 leading-relaxed text-neutral-500 dark:text-neutral-400">{s.description}</div>}
                          </div>
                        </div>
                      ))}
                    </div>

                    {planDetailsMode ? (
                      <div>
                        <textarea
                          value={planDetailsInput}
                          onChange={e => setPlanDetailsInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (planDetailsInput.trim()) generatePlan(planOriginalMsg, planDetailsInput.trim()); } }}
                          placeholder="Give more details to improve the plan…"
                          rows={2}
                          autoFocus
                          className="w-full text-[14px] rounded-md px-3 py-2 resize-none outline-none border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:border-neutral-400 dark:focus:border-neutral-500"
                        />
                        <div className="flex items-center justify-end gap-1.5 mt-2">
                          <button
                            onClick={() => { setPlanDetailsMode(false); setPlanDetailsInput(''); }}
                            className="h-7 px-3 rounded-[5px] text-[13px] text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          >Back</button>
                          <button
                            onClick={() => { if (planDetailsInput.trim()) generatePlan(planOriginalMsg, planDetailsInput.trim()); }}
                            disabled={!planDetailsInput.trim()}
                            className="h-7 px-3 rounded-[5px] text-[13px] font-medium bg-blue-500 text-white dark:bg-blue-400 dark:text-neutral-950 hover:bg-blue-600 dark:hover:bg-blue-300 disabled:opacity-50"
                          >Regenerate</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5 pt-0.5">
                        <button
                          onClick={() => setPlanDetailsMode(true)}
                          className="h-7 px-3 rounded-[5px] text-[13px] text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >Give more details</button>
                        <button
                          onClick={validatePlan}
                          className="h-7 px-3.5 rounded-[5px] text-[13px] font-medium bg-blue-500 text-white dark:bg-blue-400 dark:text-neutral-950 hover:bg-blue-600 dark:hover:bg-blue-300"
                        >✓ Validate the plan</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div
              ref={promptBoxRef}
              className="rounded-3xl relative"
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer?.types.includes('Files')) { dragCounterRef.current += 1; setIsDragOver(true); } }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); dragCounterRef.current -= 1; if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setIsDragOver(false); } }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dragCounterRef.current = 0; setIsDragOver(false); if (e.dataTransfer?.files?.length) handleFilesSelected(e.dataTransfer.files); }}
              style={{
                background: 'var(--surface-3)',
                border: `1px solid ${isDragOver ? 'var(--teal)' : isListening ? 'var(--text-primary)' : 'var(--border-default)'}`,
                boxShadow: isDragOver ? '0 0 0 3px rgba(45,212,191,0.15)' : isListening ? '0 0 24px rgba(255,255,255,0.1)' : '0 8px 30px rgba(0,0,0,0.24)',
                transition: 'border-color 0.2s, box-shadow 0.2s',
                overflow: 'hidden',
              }}
            >
              {/* Drag overlay */}
              {isDragOver && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-3xl pointer-events-none" style={{ background: 'rgba(45,212,191,0.07)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--teal)' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><polyline points="17 8 12 3 7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span className="text-[12px] font-medium" style={{ color: 'var(--teal)' }}>Drop here</span>
                </div>
              )}
              {/* "Agent is running" banner — inside the bordered box, lighter bg */}
              {isBuildingThis && (
                <div className="px-4 pt-3 pb-2.5 agent-running-container" style={{ background: 'rgba(255,255,255,0.055)' }}>
                  <div className="flex items-center gap-2.5">
                    <div className="agent-running-dot" />
                    <span className="text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>
                      Agent is running
                    </span>
                    <span className="agent-running-dots text-[14px]" style={{ color: 'var(--text-muted)' }}>•••</span>
                  </div>
                </div>
              )}



              {/* Mobile attach popup */}
              {showAttachPopup && (
                <div
                  className="fixed inset-0 z-50 flex items-end justify-center"
                  style={{ background: 'rgba(0,0,0,0.5)' }}
                  onClick={() => setShowAttachPopup(false)}
                >
                  <div
                    className="w-full max-w-sm rounded-t-2xl p-4 pb-8 flex flex-col gap-3"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
                    onClick={e => e.stopPropagation()}
                  >
                    <p className="text-center text-[13px] font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Add a file</p>
                    <button
                      className="flex items-center gap-3 px-4 py-3 rounded-xl text-[14px]"
                      style={{ background: 'var(--surface-4)', color: 'var(--text-secondary)' }}
                      onClick={() => { setShowAttachPopup(false); openImagePicker(); }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.6"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M3 16l5-5 4 4 3-3 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      Image
                    </button>
                    <button
                      className="flex items-center gap-3 px-4 py-3 rounded-xl text-[14px]"
                      style={{ background: 'var(--surface-4)', color: 'var(--text-secondary)' }}
                      onClick={() => { setShowAttachPopup(false); openFilePicker(); }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      File
                    </button>
                    <button
                      className="mt-1 py-2 rounded-xl text-[13px]"
                      style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}
                      onClick={() => setShowAttachPopup(false)}
                    >Cancel</button>
                  </div>
                </div>
              )}

              {/* Attachment previews */}
              {attachments.length > 0 && (
                <div className="px-3 pt-2.5 flex flex-wrap gap-2">
                  {attachments.map(att => {
                    const isImg = att.type === 'image' && !!att.previewUrl;
                    const ext = att.name.split('.').pop()?.toLowerCase() || '';
                    const isCode = ['js','ts','jsx','tsx','py','rb','go','rs','java','c','cpp','h','php','cs','swift','kt'].includes(ext);
                    const isData = ['json','yaml','yml','xml'].includes(ext);
                    return (
                      <AttachmentChip
                        key={att.id}
                        name={att.name}
                        size={att.size}
                        isImage={isImg}
                        previewUrl={att.previewUrl}
                        iconType={isImg ? 'image' : isCode ? 'code' : isData ? 'data' : 'text'}
                        onRemove={() => removeAttachment(att.id)}
                      />
                    );
                  })}
                </div>
              )}

              {/* Fichiers référencés via "/" (chemin + contenu envoyés à l'IA) */}
              {pickedFiles.length > 0 && (
                <div className="px-3 pt-2.5 flex flex-wrap gap-2">
                  {pickedFiles.map(f => (
                    <div
                      key={f.kind + f.path}
                      className="flex items-center gap-1.5 h-7 pl-2 pr-1 rounded-md text-[12px] max-w-[220px]"
                      style={{ background: 'var(--surface-4)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                      title={f.path}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.7, flexShrink: 0 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      <span className="truncate">{f.name}</span>
                      <button
                        onClick={() => removePickedFile(f)}
                        className="w-4 h-4 flex items-center justify-center rounded hover:opacity-70 shrink-0"
                        style={{ color: 'var(--text-dim)' }}
                        title="Retirer"
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div
                className="px-5 pt-4 pb-2 relative"
              >
                {/* Puce de commande : posée sur la 1re ligne du textarea, le
                    texte tapé démarre juste après (textIndent). */}
                {cmdChip && (
                  <span style={{ position: 'absolute', left: 20, top: 17, zIndex: 2 }}>
                    <CommandChip innerRef={cmdChipRef} cmd={cmdChip} onRemove={() => { setCmdChip(null); inputRef.current?.focus(); }} />
                  </span>
                )}
                {/* Menu "/" : commandes disponibles + fichiers du projet */}
                {slashOpen && (
                  <SlashMenuShell anchor={promptBoxRef.current} onClose={() => { setSlashOpen(false); slashStartRef.current = -1; }}>
                    {(slashCommands.length + slashResults.length) === 0 && (
                      <div className="px-3 py-6 text-center text-[12px]" style={{ color: 'var(--text-faint)' }}>Aucun résultat</div>
                    )}
                    {slashCommands.length > 0 && slashResults.length > 0 && (
                      <div className="px-3 pt-1 pb-1.5 text-[10.5px] font-semibold tracking-wide uppercase" style={{ color: 'var(--text-ghost)' }}>Commandes</div>
                    )}
                    {slashCommands.map((cmd, i) => (
                      <SlashRow
                        key={'cmd-' + cmd.cmd}
                        label={cmd.label}
                        desc={cmd.desc}
                        active={i === slashIndex}
                        onHover={() => setSlashIndex(i)}
                        onPick={() => pickSlashCommand(cmd.cmd)}
                      />
                    ))}
                    {slashResults.length > 0 && slashCommands.length > 0 && (
                      <div className="px-3 pt-2 pb-1.5 text-[10.5px] font-semibold tracking-wide uppercase" style={{ color: 'var(--text-ghost)' }}>Fichiers</div>
                    )}
                    {slashResults.map((f, i0) => { const i = i0 + slashCommands.length; return (
                      <SlashRow
                        key={f.kind + f.path}
                        label={f.name}
                        desc={f.kind === 'attachment' ? 'joint' : f.path}
                        active={i === slashIndex}
                        onHover={() => setSlashIndex(i)}
                        onPick={() => pickSlashFile(f)}
                      />
                    ); })}
                  </SlashMenuShell>
                )}
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={isListening ? 'Speak now…' : isBuildingThis ? `Give ${BRAND} a task...` : chatLoading ? 'AI is responding...' : `Ask ${BRAND} anything...`}
                  rows={1}
                  disabled={isWorking}
                  className="w-full text-[15px] bg-transparent focus:outline-none resize-none leading-relaxed disabled:opacity-30"
                  style={{ color: 'var(--text-secondary)', maxHeight: 140, textIndent: cmdChip ? cmdChipW + 6 : 0 } as any}
                />
              </div>
              <div className="px-4 pb-3 flex items-center gap-2">
                {/* ── Bouton « + » — ouvre le sélecteur de fichiers ── */}
                <div className="relative w-7 h-7" style={{ flexShrink: 0 }}>
                  <div className="w-7 h-7 flex items-center justify-center rounded-md" style={{ color: 'var(--text-dim)' }} title="Ajouter des fichiers">
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M7.5 2.5V12.5M2.5 7.5H12.5" />
                    </svg>
                  </div>
                  {!isWorking && (
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*,.pdf,.txt,.md,.csv,.json,.js,.ts,.jsx,.tsx,.py,.html,.css,.yml,.yaml,.xml,.sh,.rb,.go,.java,.c,.cpp,.rs"
                      onChange={handleFileInputChange}
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', fontSize: 0 }}
                      title="Ajouter des fichiers"
                    />
                  )}
                </div>

                {/* Media Studio (Higgsfield) button */}
                <button
                  onClick={() => setShowMediaStudio(true)}
                  disabled={isWorking}
                  className="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium transition-all hover:opacity-80 disabled:opacity-30"
                  style={{ color: 'var(--text-dim)', background: 'var(--surface-4)' }}
                  title="Media Studio — generate image / video / avatar (Higgsfield)"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" fill="currentColor"/></svg>
                  Media
                </button>

                <div className="ml-auto flex items-center gap-2">
                  {/* ── Model tier picker ── */}
                  <div>
                    <button
                      ref={modelBtnRef}
                      onClick={openTierPicker}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] transition-all hover:opacity-80"
                      style={{ background: 'var(--surface-4)', color: 'var(--text-dim)' }}
                      title="Choose mode"
                    >
                      <span>{currentTier.label}</span>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ opacity: 0.5 }}>
                        <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/>
                      </svg>
                    </button>
                  </div>
                  {/* ── Tier picker (DESKTOP) — popover ancré au bouton ── */}
                  {showModelPicker && !isMobile && tierPickerPos && (
                    <div
                      ref={modelPickerRef}
                      className={`rounded-xl z-[9999] shadow-xl ${pickerClosing ? 'animate-popover-out' : 'animate-popover-in'}`}
                      style={{
                        position: 'fixed',
                        bottom: tierPickerPos.bottom,
                        right: tierPickerPos.right,
                        background: 'var(--surface-1)',
                        border: '1px solid var(--border)',
                        minWidth: 210,
                        overflow: 'hidden',
                      }}
                    >
                      {MODEL_TIERS.map(tier => (
                        <button
                          key={tier.id}
                          onClick={() => {
                            setModelTier(tier.id);
                            localStorage.setItem('velbaz_model_tier', tier.id);
                            closeTierPicker();
                          }}
                          className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-all hover:opacity-80"
                          style={{
                            background: modelTier === tier.id ? 'var(--surface-3)' : 'transparent',
                            color: 'var(--text-primary)',
                          }}
                        >
                          <div>
                            <div className="text-[13px] font-medium">{tier.label}</div>
                            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>{tier.desc}</div>
                          </div>
                          <div className="text-[11px] ml-3 shrink-0" style={{ color: 'var(--text-faint)' }}>{tier.tokens}</div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* ── Tier picker (TÉLÉPHONE) — bottom sheet plein écran ──
                      Fini le popover positionné au pixel (qui finissait hors
                      écran / sous le clavier sur mobile → impossible de choisir).
                      Ici : un fond cliquable + une feuille en bas d'écran avec de
                      grandes zones tactiles. Toujours visible, toujours cliquable. */}
                  {showModelPicker && isMobile && (
                    <div
                      className={`fixed inset-0 z-[9998] ${pickerClosing ? 'animate-backdrop-out' : ''}`}
                      style={{ background: 'rgba(0,0,0,0.5)' }}
                      onClick={() => closeTierPicker()}
                    >
                      <div
                        ref={modelPickerRef}
                        className={`fixed left-0 right-0 bottom-0 z-[9999] rounded-t-2xl shadow-2xl pb-[env(safe-area-inset-bottom)] ${pickerClosing ? 'animate-sheet-out' : 'animate-sheet-in'}`}
                        style={{ background: 'var(--surface-1)', borderTop: '1px solid var(--border)' }}
                        onClick={e => e.stopPropagation()}
                      >
                        <div className="flex justify-center pt-2.5 pb-1">
                          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
                        </div>
                        <div className="px-4 pt-1 pb-2 text-[12px] font-medium" style={{ color: 'var(--text-faint)' }}>
                          Choose mode
                        </div>
                        {MODEL_TIERS.map(tier => (
                          <button
                            key={tier.id}
                            onClick={() => {
                              setModelTier(tier.id);
                              localStorage.setItem('velbaz_model_tier', tier.id);
                              closeTierPicker();
                            }}
                            className="w-full flex items-center justify-between px-5 py-4 text-left active:opacity-70"
                            style={{
                              background: modelTier === tier.id ? 'var(--surface-3)' : 'transparent',
                              color: 'var(--text-primary)',
                              borderTop: '1px solid var(--border)',
                            }}
                          >
                            <div>
                              <div className="text-[15px] font-semibold flex items-center gap-2">
                                {tier.label}
                                {modelTier === tier.id && (
                                  <svg width="15" height="15" viewBox="0 0 20 20" fill="none"><path d="M4 10.5L8 14.5L16 5.5" stroke="var(--teal)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                )}
                              </div>
                              <div className="text-[12px] mt-1" style={{ color: 'var(--text-faint)' }}>{tier.desc}</div>
                            </div>
                            <div className="text-[12px] ml-3 shrink-0" style={{ color: 'var(--text-faint)' }}>{tier.tokens}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Mic button */}
                  {!showCancel && <VoiceMicButton isListening={isListening} onClick={toggleVoice} />}

                  {/* Plan mode toggle */}
                  {!showCancel && (
                    <button
                      onClick={() => setPlanMode(p => !p)}
                      className="flex items-center justify-center px-4 h-7 rounded-full text-[12px] font-medium transition-all hover:opacity-80"
                      style={{
                        background: planMode ? 'var(--teal)' : 'var(--surface-4)',
                        color: planMode ? '#06222E' : 'var(--text-dim)',
                      }}
                      title={planMode ? 'Plan mode enabled — the AI creates a plan before working' : 'Enable plan mode'}
                    >
                      Plan
                    </button>
                  )}

                  {showCancel ? (
                    <button
                      onClick={cancelRequest}
                      className="w-8 h-8 flex items-center justify-center rounded-full transition-all"
                      style={{ background: 'var(--text-secondary)', color: 'var(--surface-0)' }}
                      title="Stop"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                        <rect x="3" y="3" width="8" height="8" rx="1.5" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      onClick={() => { if (isListening) stopListening(); sendMessage(); }}
                      disabled={(!input.trim() && attachments.length === 0) || isWorking}
                      className="w-8 h-8 flex items-center justify-center rounded-full transition-all disabled:opacity-40"
                      style={{ background: (input.trim() || attachments.length > 0) ? '#ffffff' : 'var(--surface-4)', color: (input.trim() || attachments.length > 0) ? '#000000' : 'var(--text-dim)' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
            </div>
            <p className="text-[10px] text-center mt-1.5" style={{ color: 'var(--border-hover)' }}>Enter to send · Shift+Enter for new line · Drag & drop files</p>
          </div>
        </div>
      </div>

      {/* ─── Right: Preview Panel with drag resize ─── */}
      {effectiveShowPreview && (
        <>
          {/* Drag handle — uniquement pour le rectangle web (la zone Téléphone est à largeur fixe).
              Jamais sur téléphone : la preview y est en plein écran. */}
          {!phoneZone && !isMobile && (
            <div
              onPointerDown={onDragStart}
              className="resize-handle"
              style={{ width: 8, touchAction: 'none' }}
            />
          )}

          <div
            className="overflow-hidden preview-panel-enter"
            style={{
              position: isMobile ? 'fixed' : 'relative',
              inset: isMobile ? 0 : undefined,
              zIndex: isMobile ? 60 : undefined,
              display: 'flex', flexDirection: 'column',
              width: isMobile ? '100%' : (phoneZone ? 640 : `${previewWidth}%`),
              height: isMobile ? '100%' : undefined,
              flexShrink: isMobile ? undefined : (phoneZone ? 0 : undefined),
              maxWidth: isMobile ? 'none' : (phoneZone ? '70%' : undefined),
              transition: isDraggingState ? 'none' : 'width 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
              background: 'transparent',
              borderLeft: isMobile ? 'none' : '1px solid var(--border-subtle)',
            }}
          >
            {/* Bouton fermer (X) en haut à gauche — plein écran mobile uniquement */}
            {isMobile && (
              <button
                onClick={() => setPanelCollapsed(true)}
                title="Close preview"
                style={{
                  position: 'absolute', top: 12, left: 12, zIndex: 70,
                  width: 36, height: 36, borderRadius: 999,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--surface-3)', border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)', cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.28)',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
            {/* ── Barre d'outils déplacée dans le panneau latéral gauche (ouvert par le bouton flottant) ── */}

            {/* ── Zone de contenu (sous la barre d'outils, jamais recouverte) ── */}
            <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', display: 'flex' }}>
            {phoneZone && projectId ? (
              /* Zone Téléphone : SA PROPRE zone, hors du rectangle scalable */
              <PhonePreviewPanel companyId={projectId} building={isBuildingWebsiteThis} />
            ) : (
              /* Rectangle de preview (web / code / commandes) — encadré, SOUS la barre d'outils */
              <div style={{
                flex: 1, position: 'relative', overflow: 'hidden', minWidth: 0,
                margin: websiteViewable && projectId ? '8px 10px 10px' : 0,
                border: websiteViewable && projectId ? '1px solid var(--border-subtle)' : 'none',
                borderRadius: websiteViewable && projectId ? 10 : 0,
                background: '#000',
              }}>
              {websiteViewable && projectId && showSocialPanel
                ? <SocialConnectPanel companyId={projectId} />
                : websiteViewable && projectId && panelMode === 'orders'
                  ? <OrdersPanel companyId={projectId} />
                : websiteViewable && projectId && panelMode === 'code'
                  ? <CodePanel companyId={projectId} isBuilding={isBuildingWebsiteThis} />
                : websiteViewable && projectId
                  ? <WebsitePreview companyId={projectId} refreshKey={previewRefreshKey} onSlugChange={setCurrentPreviewSlug} />
                  : <WebsiteLoadingSkeleton
                      progress={build.buildProgress}
                      currentTask={build.currentTask}
                      parallelCount={build.parallelCount}
                      companyId={projectId || undefined}
                      building={isBuildingThis || isBuildingWebsiteThis}
                    />
              }
              </div>
            )}
            </div>

            {/* "Next" button — bottom right → opens social connect panel */}
            {build.websiteReady && projectId && !showSocialPanel && (
              <button
                onClick={goToSocialPanel}
                style={{
                  position: 'absolute', bottom: 16, right: 16, zIndex: 30,
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 16px', fontSize: 13, fontWeight: 600,
                  background: 'var(--blue-accent)', color: '#fff',
                  border: 'none', borderRadius: 8, cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
              >
                Next
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
        </>
      )}

      {/* ─── Right: Panneau des tasks IA (mode auto, quand aucune preview n'est affichée) ─── */}
      {showAutoPanel && (
        <div
          className="overflow-hidden preview-panel-enter"
          style={{
            position: 'relative',
            display: 'flex', flexDirection: 'column',
            width: 400, flexShrink: 0, maxWidth: '46%',
            background: 'transparent',
            borderLeft: '1px solid var(--border-subtle)',
          }}
        >
          <AutopilotTaskPanel companyId={projectId!} />
        </div>
      )}

      {/* ─── Collapsed tab (right edge) to restore preview — petit rectangle cliquable.
          Sur téléphone : la flèche pointe vers la droite (→) et rouvre la preview en plein écran. ─── */}
      {showPreview && panelCollapsed && (
        <div
          onClick={restorePanel}
          className={`preview-restore-tab${isMobile ? ' preview-restore-tab--mobile' : ''}`}
          title="Open preview"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {isMobile
              ? <polyline points="9 18 15 12 9 6" />
              : <polyline points="15 18 9 12 15 6" />}
          </svg>
        </div>
      )}

      {/* ─── Bouton flottant à DROITE — toujours visible sur la page du site.
          Quand le panneau s'ouvre, le bouton glisse vers la gauche pour rester
          collé au bord du panneau. ─── */}
      {!isMobile && user && (
        <PanelToggleButton
          open={leftBarOpen}
          onClick={() => setLeftBarOpen(v => !v)}
          style={{
            position: 'absolute',
            top: 12,
            right: leftBarOpen ? 292 : 12,
            zIndex: 90,
            transition: isDraggingState
              ? 'none'
              : 'right 0.4s cubic-bezier(0.22, 1, 0.36, 1), transform 0.2s, box-shadow 0.2s, background 0.15s',
          }}
        />
      )}

      {/* ─── Barre latérale DROITE — s'ouvre en glissant par-dessus le contenu.
          Contient les contrôles de l'ancienne barre du haut + les sections
          Canvas et Model Preference (vides pour l'instant, comme sur la maquette). ─── */}
      {!isMobile && user && (
        <div
          style={{
            position: 'absolute', top: 0, bottom: 0, right: 0, width: 280, zIndex: 85,
            background: 'transparent', borderLeft: 'none',
            boxShadow: 'none',
            transform: leftBarOpen ? 'translateX(0)' : 'translateX(100%)',
            transition: 'transform 0.38s cubic-bezier(0.22, 1, 0.36, 1)',
            display: 'flex', flexDirection: 'column', overflowY: 'auto',
            padding: '0 10px 12px', gap: 10,
            pointerEvents: leftBarOpen ? 'auto' : 'none',
          }}
        >
          {/* Header */}
          <div style={{ padding: '14px 4px 2px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Context</span>
            <button
              onClick={() => setLeftBarOpen(false)}
              title="Fermer"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-ghost)', display: 'flex', padding: 4 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
          </div>

          {/* Projet */}
          <div style={PANEL_CARD}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Velbaz</div>
            <div style={{ fontSize: 11, color: 'var(--text-ghost)' }}>website</div>
          </div>

          {/* ── Auto mode — dans le panneau de droite (Context) ── */}
          <div style={PANEL_CARD}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Auto mode</div>
            <button
              onClick={toggleAutoMode}
              disabled={autoToggling}
              title={autoMode ? 'Disable auto mode' : 'Enable auto mode (the AI plans and executes tasks)'}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                background: autoMode ? 'var(--blue-accent)' : 'var(--surface-1)',
                color: autoMode ? '#06222E' : 'var(--text-dim)',
                border: '1px solid var(--border-subtle)',
                cursor: autoToggling ? 'default' : 'pointer',
                opacity: autoToggling ? 0.6 : 1,
                transition: 'all 0.15s',
              }}
            >
              <span style={{
                width: 6, height: 6, borderRadius: 999, flexShrink: 0,
                background: autoMode ? '#06222E' : 'var(--text-dim)',
                boxShadow: autoMode ? '0 0 6px #06222E' : 'none',
              }} />
              Auto
              <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 500, opacity: 0.8 }}>
                {autoMode ? 'On' : 'Off'}
              </span>
            </button>
            <div style={{ fontSize: 11, color: 'var(--text-ghost)', marginTop: 6, lineHeight: 1.4 }}>
              L'IA planifie et exécute les tâches toute seule.
            </div>
          </div>

          {/* Contrôles déplacés depuis la barre du haut de la preview */}
          {build.websiteReady && projectId && !showSocialPanel && (
            <div style={{ ...PANEL_CARD, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {projectType === 'both' && panelMode === 'preview' && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => setPreviewDevice('web')}
                    title="Website preview"
                    style={{
                      flex: 1, padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                      background: previewDevice === 'web' ? 'var(--blue-accent)' : 'var(--surface-1)',
                      color: previewDevice === 'web' ? '#06222E' : 'var(--text-dim)',
                      border: '1px solid var(--border-subtle)', cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    🌐 Web{previewDevice === 'web' ? ' ✓' : ''}
                  </button>
                  <button
                    onClick={() => setPreviewDevice('phone')}
                    title="Mobile app preview (iPhone frame + QR code)"
                    style={{
                      flex: 1, padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                      background: previewDevice === 'phone' ? 'var(--blue-accent)' : 'var(--surface-1)',
                      color: previewDevice === 'phone' ? '#06222E' : 'var(--text-dim)',
                      border: '1px solid var(--border-subtle)', cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    📱 Phone{previewDevice === 'phone' ? ' ✓' : ''}
                  </button>
                </div>
              )}
              <GithubExportButton companyId={projectId} />
              <button
                onClick={() => {
                  setPanelMode('preview');
                  setPanelCollapsed(false);
                  setPreviewRefreshKey(k => k + 1);
                }}
                title="Preview"
                style={{
                  padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, textAlign: 'left',
                  background: panelMode === 'preview' ? 'var(--blue-accent)' : 'var(--surface-1)',
                  color: panelMode === 'preview' ? '#06222E' : 'var(--text-dim)',
                  border: '1px solid var(--border-subtle)', cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                Preview
              </button>
              <button
                onClick={() => setPanelMode(panelMode === 'code' ? 'preview' : 'code')}
                style={{
                  padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, textAlign: 'left',
                  background: panelMode === 'code' ? 'var(--blue-accent)' : 'var(--surface-1)',
                  color: panelMode === 'code' ? '#06222E' : 'var(--text-dim)',
                  border: '1px solid var(--border-subtle)', cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                Code
              </button>
              <button
                onClick={() => setPanelMode(panelMode === 'orders' ? 'preview' : 'orders')}
                style={{
                  padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, textAlign: 'left',
                  background: panelMode === 'orders' ? 'var(--blue-accent)' : 'var(--surface-1)',
                  color: panelMode === 'orders' ? '#06222E' : 'var(--text-dim)',
                  border: '1px solid var(--border-subtle)', cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                Orders
              </button>
            </div>
          )}

          {/* Canvas — vide pour l'instant */}
          <div style={PANEL_CARD}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Canvas</div>
          </div>

          {/* Model Preference — vide pour l'instant */}
          <div style={PANEL_CARD}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Model Preference</div>
            <div style={{ fontSize: 11, color: 'var(--text-ghost)', marginTop: 2 }}>Applied across all Agent mode chats.</div>
          </div>
        </div>
      )}

      {/* Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(4px)' }}>
          <div className="rounded-xl p-6 w-[340px] relative" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-default)' }}>
            <button
              onClick={() => setShowAuthModal(false)}
              className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center rounded-md"
              style={{ color: 'var(--text-dim)' }}
            >
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
                <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>

            <div className="flex flex-col items-center gap-1 mb-5">
              <VelbazIcon state="idle" size={28} />
              <h2 className="text-[16px] font-semibold mt-2" style={{ color: 'var(--text-secondary)' }}>Sign in to continue</h2>
              <p className="text-[12px] text-center" style={{ color: 'var(--text-dim)' }}>Create an account or sign in to chat with {BRAND} AI.</p>
            </div>

            <div className="flex flex-col gap-2.5">
              <a
                href="/register"
                className="flex items-center justify-center h-9 rounded-lg text-[13px] font-medium transition-colors hover:opacity-90"
                style={{ background: 'var(--blue-accent)', color: '#fff' }}
              >
                Create Account
              </a>
              <a
                href="/login"
                className="flex items-center justify-center h-9 rounded-lg text-[13px] font-medium transition-colors"
                style={{ background: 'var(--surface-4)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}
              >
                Sign In
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Panneau « Activité IA en direct » supprimé — l'action en cours s'affiche
          désormais en texte simple directement dans le fil du chat. */}
    </div>
  );
}

