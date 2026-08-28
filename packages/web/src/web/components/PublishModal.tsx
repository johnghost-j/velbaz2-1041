import { useEffect, useRef, useState, useCallback } from 'react';

// ─── "Publish your website" ──────────────────────────────────────────────────
// Popup fidèle au design Runable : sous-domaine éditable, More Settings
// (Availability + Visibility), domaine personnalisé, puis lien live dans une
// popup en dessous. Branché sur le backend réel (/api/companies/:id/publish…).

type PublishState = {
  published: boolean;
  publishedAt?: number | null;
  subdomain: string | null;
  subdomainDisplay: string | null;
  liveUrl: string | null;
  availabilityMode: 'wake' | 'always';
  visibility: 'public' | 'private';
  customDomain: string | null;
  deployConfigured: boolean;
};

// Palette sombre calquée sur les captures.
const C = {
  card: '#161616',
  cardBorder: '#2a2a2a',
  field: '#1c1c1c',
  fieldBorder: '#333',
  fieldBorderHi: '#4a4a4a',
  text: '#f5f5f5',
  dim: '#8a8a8a',
  faint: '#6a6a6a',
  white: '#ffffff',
  chip: '#242424',
  segOn: '#2c2c2c',
};

function authHeaders(json = false): Record<string, string> {
  const token = localStorage.getItem('token');
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function IconCopy({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}
function IconEdit({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function IconCheck({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>;
}
function IconX({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>;
}
function IconGlobe({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>;
}
function IconCredit({ size = 13 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9 9.5a3 3 0 0 1 3-1.5c1.5 0 2.5 1 2.5 2s-1 1.8-2.5 2-2.5 1-2.5 2 1 2 2.5 2a3 3 0 0 0 3-1.5" /></svg>;
}

export function PublishModal({
  companyId,
  onClose,
}: {
  companyId: string;
  onClose: () => void;
}) {
  const [st, setSt] = useState<PublishState | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'main' | 'domains'>('main');
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Édition du sous-domaine.
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState('');
  const [checkState, setCheckState] = useState<{ available: boolean; error: string | null } | null>(null);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Domaine personnalisé.
  const [domainInput, setDomainInput] = useState('');
  const [domainMsg, setDomainMsg] = useState('');

  // Popup de succès (lien live).
  const [publishedLink, setPublishedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/companies/${companyId}/publish`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) {
        setSt(data);
        if (data.published && data.liveUrl) setPublishedLink(data.liveUrl);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  // Fermer avec Échap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const startEdit = () => {
    setEditVal(st?.subdomain || '');
    setCheckState(null);
    setEditing(true);
  };

  const onEditChange = (v: string) => {
    const clean = v.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setEditVal(clean);
    setCheckState(null);
    if (checkTimer.current) clearTimeout(checkTimer.current);
    if (!clean) return;
    checkTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/companies/${companyId}/publish/check?value=${encodeURIComponent(clean)}`, { headers: authHeaders() });
        const data = await res.json();
        setCheckState({ available: !!data.available, error: data.error || null });
      } catch { /* ignore */ }
    }, 350);
  };

  const confirmEdit = async () => {
    if (!editVal || (checkState && !checkState.available)) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch(`/api/companies/${companyId}/publish/settings`, {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify({ subdomain: editVal }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Error'); }
      else { setSt(data); setEditing(false); }
    } catch { setErr('Network error'); }
    setBusy(false);
  };

  const setAvailability = async (mode: 'wake' | 'always') => {
    if (!st) return;
    setSt({ ...st, availabilityMode: mode });
    await fetch(`/api/companies/${companyId}/publish/settings`, {
      method: 'POST', headers: authHeaders(true), body: JSON.stringify({ availabilityMode: mode }),
    }).catch(() => {});
  };
  const setVisibility = async (vis: 'public' | 'private') => {
    if (!st) return;
    setSt({ ...st, visibility: vis });
    await fetch(`/api/companies/${companyId}/publish/settings`, {
      method: 'POST', headers: authHeaders(true), body: JSON.stringify({ visibility: vis }),
    }).catch(() => {});
  };

  const publish = async () => {
    if (editing) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch(`/api/companies/${companyId}/publish`, {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({
          availabilityMode: st?.availabilityMode,
          visibility: st?.visibility,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Échec de la publication'); }
      else { setSt(data); setPublishedLink(data.liveUrl); }
    } catch { setErr('Network error'); }
    setBusy(false);
  };

  const connectDomain = async () => {
    const d = domainInput.trim();
    if (!d) return;
    setBusy(true); setDomainMsg('');
    try {
      const res = await fetch(`/api/companies/${companyId}/custom-domain`, {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify({ domain: d }),
      });
      const data = await res.json();
      if (!res.ok) { setDomainMsg(data.error || 'Error'); }
      else {
        setSt(data);
        setDomainInput('');
        setDomainMsg(
          data.needsDeployKey
            ? `Domain saved. Add a CNAME ${data.dns?.name} → ${data.dns?.value}. The final connection will activate once a deploy key is configured in the admin panel.`
            : `Domain connected. Add a CNAME ${data.dns?.name} → ${data.dns?.value} with your registrar.`,
        );
      }
    } catch { setDomainMsg('Network error'); }
    setBusy(false);
  };

  const copy = async (text: string, tag: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(tag); setTimeout(() => setCopied(''), 1500); } catch { /* ignore */ }
  };

  const canPublish = !busy && !editing && !!st;

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: view === 'domains' ? 560 : 460,
          maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto',
          background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 20,
          padding: 26, boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
          fontFamily: 'system-ui, -apple-system, sans-serif', color: C.text,
        }}
      >
        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: C.dim, fontSize: 13 }}>Chargement…</div>
        ) : view === 'domains' ? (
          // ─── Vue DOMAINS (captures 4 & 5) ───
          <DomainsView
            st={st!}
            domainInput={domainInput}
            setDomainInput={setDomainInput}
            domainMsg={domainMsg}
            busy={busy}
            copied={copied}
            copy={copy}
            connectDomain={connectDomain}
            onBack={() => { setView('main'); setDomainMsg(''); }}
          />
        ) : (
          // ─── Vue PUBLISH principale ───
          <>
            <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: -0.3 }}>Publish your website</div>
            <div style={{ fontSize: 14, color: C.dim, marginTop: 4 }}>This will help you get discovered</div>

            {/* Your Subdomain */}
            <div style={{ marginTop: 26, fontSize: 15 }}>Your Subdomain</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'stretch' }}>
              <div
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: 2,
                  background: C.field, border: `1px solid ${editing ? C.fieldBorderHi : C.fieldBorder}`,
                  borderRadius: 12, padding: '0 16px', height: 52, minWidth: 0,
                }}
              >
                {editing ? (
                  <>
                    <input
                      autoFocus
                      value={editVal}
                      onChange={(e) => onEditChange(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') confirmEdit(); }}
                      style={{
                        flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
                        color: C.text, fontSize: 15,
                      }}
                    />
                    <span style={{ color: C.faint, fontSize: 15, whiteSpace: 'nowrap' }}>.velbaz.site</span>
                  </>
                ) : (
                  <span style={{ fontSize: 15, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {st?.subdomainDisplay || '—'}
                  </span>
                )}
              </div>

              {editing ? (
                <>
                  <IconBtn onClick={() => { setEditing(false); setErr(''); }} title="Annuler"><IconX /></IconBtn>
                  <IconBtn
                    onClick={confirmEdit}
                    disabled={!editVal || (checkState ? !checkState.available : false) || busy}
                    title="Confirmer"
                  ><IconCheck /></IconBtn>
                </>
              ) : (
                <>
                  <IconBtn onClick={() => copy(st?.subdomainDisplay || '', 'sub')} title="Copier">
                    {copied === 'sub' ? <IconCheck /> : <IconCopy />}
                  </IconBtn>
                  <IconBtn onClick={startEdit} title="Modifier"><IconEdit /></IconBtn>
                </>
              )}
            </div>
            {editing && checkState && !checkState.available && (
              <div style={{ fontSize: 12.5, color: '#ff6b6b', marginTop: 8 }}>{checkState.error}</div>
            )}
            {editing && checkState && checkState.available && (
              <div style={{ fontSize: 12.5, color: '#4ade80', marginTop: 8 }}>Disponible</div>
            )}

            {/* Add custom domain */}
            <button
              onClick={() => setView('domains')}
              style={{
                marginTop: 20, background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                color: C.dim, fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              Add custom domain
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
            </button>

            {/* More Settings */}
            <button
              onClick={() => setMoreOpen((v) => !v)}
              style={{
                width: '100%', marginTop: 22, background: 'none', border: 'none', cursor: 'pointer',
                padding: 0, color: C.text, fontSize: 16,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <span>More Settings</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: moreOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>

            {moreOpen && (
              <div style={{ marginTop: 22 }}>
                {/* Availability */}
                <div style={{ fontSize: 15, marginBottom: 12 }}>Availability</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <AvailCard
                    title="Wake on Active" credits="500 credits/month"
                    desc={<>Sleeps between visits.<br />Loads in 3-5 sec.</>}
                    selected={st?.availabilityMode === 'wake'}
                    onClick={() => setAvailability('wake')}
                  />
                  <AvailCard
                    title="Always On" credits="5000 credits/month"
                    desc={<>Always live.<br />Instant load, every time.</>}
                    selected={st?.availabilityMode === 'always'}
                    onClick={() => setAvailability('always')}
                  />
                </div>

                {/* Visibility */}
                <div style={{ fontSize: 15, marginTop: 22, marginBottom: 12 }}>Visibility</div>
                <div style={{ display: 'flex', background: C.field, border: `1px solid ${C.fieldBorder}`, borderRadius: 12, padding: 5, gap: 4 }}>
                  {(['public', 'private'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setVisibility(v)}
                      style={{
                        flex: 1, padding: '11px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                        fontSize: 15, textTransform: 'capitalize',
                        background: st?.visibility === v ? C.segOn : 'transparent',
                        color: st?.visibility === v ? C.white : C.dim,
                        fontWeight: st?.visibility === v ? 600 : 400,
                        boxShadow: st?.visibility === v ? 'inset 0 0 0 1px #3a3a3a' : 'none',
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 13.5, color: C.faint, marginTop: 12 }}>
                  {st?.visibility === 'public'
                    ? 'Visible to search engines and anyone with the link.'
                    : 'Hidden from search engines. Only you can access it.'}
                </div>
              </div>
            )}

            {err && <div style={{ fontSize: 13, color: '#ff6b6b', marginTop: 16 }}>{err}</div>}

            {/* Publish button */}
            <button
              onClick={publish}
              disabled={!canPublish}
              style={{
                width: '100%', marginTop: 26, height: 56, borderRadius: 16, border: 'none',
                cursor: canPublish ? 'pointer' : 'default', fontSize: 17, fontWeight: 600,
                background: editing ? '#5a5a5a' : C.white,
                color: editing ? '#cfcfcf' : '#111',
                opacity: busy ? 0.7 : 1, transition: 'opacity .15s',
              }}
            >
              {busy ? 'Publishing…' : st?.published ? 'Update' : 'Publish'}
            </button>

            {/* Popup lien live (sous le bouton) */}
            {publishedLink && (
              <div
                style={{
                  marginTop: 18, padding: 16, borderRadius: 14,
                  background: '#12261a', border: '1px solid #1f4531',
                }}
              >
                <div style={{ fontSize: 13.5, color: '#4ade80', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <IconCheck size={15} /> Site published
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
                  <a
                    href={publishedLink} target="_blank" rel="noopener noreferrer"
                    style={{
                      flex: 1, minWidth: 0, fontSize: 14, color: '#d6ffe6', textDecoration: 'none',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      background: '#0e1c14', border: '1px solid #1f4531', borderRadius: 10, padding: '11px 14px',
                    }}
                  >
                    {publishedLink}
                  </a>
                  <IconBtn onClick={() => copy(publishedLink, 'live')} title="Copier">
                    {copied === 'live' ? <IconCheck /> : <IconCopy />}
                  </IconBtn>
                  <a
                    href={publishedLink} target="_blank" rel="noopener noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46,
                      background: '#0e1c14', border: '1px solid #1f4531', borderRadius: 11, color: '#d6ffe6',
                    }}
                    title="Ouvrir"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
                  </a>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sous-composants ─────────────────────────────────────────────────────────

function IconBtn({
  children, onClick, title, disabled,
}: { children: React.ReactNode; onClick: () => void; title?: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick} title={title} disabled={disabled}
      style={{
        width: 52, height: 52, flexShrink: 0, borderRadius: 12,
        background: C.field, border: `1px solid ${C.fieldBorder}`,
        color: disabled ? '#555' : C.dim, cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'color .12s, border-color .12s',
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.color = C.text; e.currentTarget.style.borderColor = C.fieldBorderHi; } }}
      onMouseLeave={(e) => { e.currentTarget.style.color = disabled ? '#555' : C.dim; e.currentTarget.style.borderColor = C.fieldBorder; }}
    >
      {children}
    </button>
  );
}

function AvailCard({
  title, credits, desc, selected, onClick,
}: {
  title: string; credits: string; desc: React.ReactNode; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left', background: C.field, cursor: 'pointer',
        border: `1px solid ${selected ? C.fieldBorderHi : C.fieldBorder}`,
        borderRadius: 14, padding: 16, position: 'relative',
        boxShadow: selected ? 'inset 0 0 0 1px #4a4a4a' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{title}</span>
        <span style={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
          border: `2px solid ${selected ? C.white : '#555'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {selected && <span style={{ width: 9, height: 9, borderRadius: '50%', background: C.white }} />}
        </span>
      </div>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14,
        background: C.chip, border: `1px solid ${C.fieldBorder}`, borderRadius: 20,
        padding: '5px 11px', fontSize: 12.5, color: C.dim,
      }}>
        <IconCredit /> {credits}
      </span>
      <div style={{ fontSize: 13.5, color: C.dim, marginTop: 14, lineHeight: 1.5 }}>{desc}</div>
    </button>
  );
}

function DomainsView({
  st, domainInput, setDomainInput, domainMsg, busy, copied, copy, connectDomain, onBack,
}: {
  st: PublishState;
  domainInput: string;
  setDomainInput: (v: string) => void;
  domainMsg: string;
  busy: boolean;
  copied: string;
  copy: (t: string, tag: string) => void;
  connectDomain: () => void;
  onBack: () => void;
}) {
  const [showInput, setShowInput] = useState(!!st.customDomain);
  return (
    <>
      <button
        onClick={onBack}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: C.dim, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 18 }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        Retour
      </button>

      <div style={{ fontSize: 20, fontWeight: 700 }}>Domains</div>

      {/* Sub-domain */}
      <div style={{ fontSize: 14, color: C.dim, marginTop: 20 }}>Sub-domain</div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginTop: 10,
        background: C.field, border: `1px solid ${C.fieldBorder}`, borderRadius: 12, padding: '0 16px', height: 54,
      }}>
        <span style={{ color: C.dim, flexShrink: 0 }}><IconGlobe /></span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {st.subdomainDisplay || '—'}
        </span>
        <button onClick={() => copy(st.subdomainDisplay || '', 'dsub')} title="Copier"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint, padding: 4 }}>
          {copied === 'dsub' ? <IconCheck size={15} /> : <IconCopy />}
        </button>
      </div>

      {/* Custom Domains */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginTop: 26 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>Custom Domains</div>
          <div style={{ fontSize: 13.5, color: C.faint, marginTop: 6, maxWidth: 380, lineHeight: 1.5 }}>
            Connect a custom domain like 'neon-dreams.com' to give your site a unique address.
          </div>
        </div>
        {!showInput && (
          <button
            onClick={() => setShowInput(true)}
            style={{
              flexShrink: 0, background: C.white, color: '#111', border: 'none', borderRadius: 12,
              padding: '12px 20px', fontSize: 14.5, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Connect Domain
          </button>
        )}
      </div>

      {st.customDomain && (
        <div style={{ marginTop: 14, fontSize: 13.5, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 7 }}>
          <IconCheck size={14} /> {st.customDomain} connected
        </div>
      )}

      {showInput && (
        <>
          <div style={{ fontSize: 17, fontWeight: 600, marginTop: 26 }}>Enter your Domain</div>
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <input
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') connectDomain(); }}
              placeholder="coffeeroasters.com"
              style={{
                flex: 1, minWidth: 0, height: 52, background: C.field, border: `1px solid ${C.fieldBorder}`,
                borderRadius: 12, padding: '0 16px', color: C.text, fontSize: 15, outline: 'none',
              }}
            />
            <button
              onClick={connectDomain}
              disabled={busy || !domainInput.trim()}
              style={{
                flexShrink: 0, background: domainInput.trim() ? C.white : '#5a5a5a',
                color: domainInput.trim() ? '#111' : '#cfcfcf', border: 'none', borderRadius: 12,
                padding: '0 26px', fontSize: 15, fontWeight: 600, cursor: domainInput.trim() ? 'pointer' : 'default',
              }}
            >
              Connect
            </button>
          </div>
        </>
      )}

      {domainMsg && (
        <div style={{ marginTop: 16, fontSize: 13, color: C.dim, background: C.field, border: `1px solid ${C.fieldBorder}`, borderRadius: 12, padding: 14, lineHeight: 1.55 }}>
          {domainMsg}
        </div>
      )}
    </>
  );
}
