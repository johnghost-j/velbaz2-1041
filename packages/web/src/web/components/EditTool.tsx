import { useState, useEffect, useMemo, memo, useRef } from 'react';

// ── Shimmer styles (injected once) ──
const SHIMMER_STYLE_ID = 'an-edit-tool-shimmer-styles';
const SHIMMER_STYLES = `
@keyframes an-edit-shimmer {
  from { background-position: 100% center; }
  to { background-position: 0% center; }
}
.an-edit-shimmer {
  display: inline-flex;
  align-items: center;
  height: 1rem;
  background-size: 250% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  background-image: linear-gradient(90deg, #a3a3a3 0%, #a3a3a3 40%, #525252 50%, #a3a3a3 60%, #a3a3a3 100%);
  background-repeat: no-repeat;
  animation: an-edit-shimmer 1.2s linear infinite;
}
@keyframes an-edit-dot {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 1; }
}
.an-edit-dot { animation: an-edit-dot 1.4s ease-in-out infinite; }
.an-edit-dot:nth-child(2) { animation-delay: 0.2s; }
.an-edit-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes an-edit-caret { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
.an-edit-caret {
  display: inline-block;
  width: 7px;
  height: 13px;
  margin-left: 1px;
  vertical-align: text-bottom;
  background: var(--green-text, #4ade80);
  animation: an-edit-caret 1s step-end infinite;
}
`;

let shimmerStylesInjected = false;
function ensureShimmerStyles() {
  if (typeof document === 'undefined') return;
  if (shimmerStylesInjected) return;
  if (document.getElementById(SHIMMER_STYLE_ID)) {
    shimmerStylesInjected = true;
    return;
  }
  const el = document.createElement('style');
  el.id = SHIMMER_STYLE_ID;
  el.textContent = SHIMMER_STYLES;
  document.head.appendChild(el);
  shimmerStylesInjected = true;
}

type DiffOp = { type: 'context' | 'remove' | 'add'; text: string };

function lineDiff(oldText: string, newText: string): DiffOp[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: 'context', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'remove', text: a[i] });
      i++;
    } else {
      ops.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < m) {
    ops.push({ type: 'remove', text: a[i] });
    i++;
  }
  while (j < n) {
    ops.push({ type: 'add', text: b[j] });
    j++;
  }
  return ops;
}

function countDiffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === 'add') added++;
    else if (op.type === 'remove') removed++;
  }
  return { added, removed };
}

export type EditToolProps = {
  /** "completed" → past-tense label + full diff; "pending" → shimmer; "waiting" → "Generating..." shimmer (no body). */
  state?: 'completed' | 'pending' | 'waiting';
  /** "edit" → "Edited"/"Editing" with diff; "write" → "Created"/"Creating" (all green lines). */
  variant?: 'edit' | 'write';
  /** Path — shown as basename in the header. */
  filePath?: string;
  /** Old file contents — required for "edit" variant; ignored for "write". */
  oldContent?: string;
  /** New file contents — both variants. */
  newContent?: string;
  /** Total lines (if we only show a snippet). */
  totalLines?: number;
  /** Total characters. */
  totalChars?: number;
};

export const EditTool = memo(function EditTool({
  state = 'completed',
  variant = 'write',
  filePath,
  oldContent,
  newContent,
  totalLines,
  totalChars,
}: EditToolProps) {
  useEffect(() => { ensureShimmerStyles(); }, []);

  const isPending = state === 'pending';
  const isWaiting = state === 'waiting';
  const isWrite = variant === 'write';
  const fileName = filePath?.split('/').pop() ?? undefined;

  const diffOps = useMemo<DiffOp[] | null>(() => {
    if (isWaiting) return null;
    if (isWrite && newContent) {
      return newContent.split('\n').map((text) => ({ type: 'add' as const, text }));
    }
    if (oldContent !== undefined && newContent !== undefined) {
      return lineDiff(oldContent, newContent);
    }
    return null;
  }, [isWaiting, isWrite, oldContent, newContent]);

  const stats = useMemo(
    () => (diffOps ? countDiffStats(diffOps) : null),
    [diffOps],
  );

  // For an edit, show the real changed-line counts from the diff. For a write
  // (whole new file), totalLines reflects the full file size.
  const displayAdded = isWrite ? (totalLines ?? stats?.added ?? 0) : (stats?.added ?? 0);
  const displayRemoved = stats?.removed ?? 0;

  const statsText = useMemo(() => {
    // Only annotate write blocks with total size; edits already show +/- counts.
    if (!isWrite) return null;
    const lines = totalLines ?? stats?.added ?? 0;
    const chars = totalChars ?? newContent?.length ?? 0;
    const parts: string[] = [];
    if (lines > 0) parts.push(`${lines.toLocaleString()} lines`);
    if (chars > 0) parts.push(`${(chars / 1024).toFixed(1)}KB`);
    return parts.length > 0 ? parts.join(' · ') : null;
  }, [isWrite, totalLines, totalChars, stats, newContent]);

  const headerLabel = isWaiting
    ? 'Generating...'
    : isPending
      ? `${isWrite ? 'Creating' : 'Editing'}${fileName ? ` ${fileName}` : ''}`
      : `${isWrite ? 'Created' : 'Edited'}${fileName ? ` ${fileName}` : ''}`;
  // While the scrolling reveal is running, show a present-tense "Writing…" header.
  const liveHeaderLabel = `Writing${fileName ? ` ${fileName}` : ''}…`;

  // Limit displayed lines to 30
  const displayOps = useMemo(() => {
    if (!diffOps) return null;
    if (diffOps.length <= 30) return diffOps;
    return diffOps.slice(0, 30);
  }, [diffOps]);

  const hasMore = diffOps && displayOps && diffOps.length > displayOps.length;
  const [expanded, setExpanded] = useState(false);
  const baseOps = expanded ? diffOps : displayOps;

  // ── Streaming code panel ──────────────────────────────────────────────
  // While a file is being written (pending write with streaming content), we
  // show a fixed-height rectangle where the code scrolls down in real time —
  // no horizontal scroll, no resize. Once the write is COMPLETED the rectangle
  // is dropped entirely and the row collapses to a compact rounded pill that
  // reads "Created <file>" — just like the other activity rows.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const shownOps = baseOps;

  // Only render the code panel while streaming (pending write) or for a
  // completed EDIT (to show the +/- diff). A completed WRITE shows no body.
  const showBody = !isWaiting && (isPending ? !!(baseOps && baseOps.length > 0) : !isWrite);

  // While code is streaming in, keep the panel pinned to the newest line so
  // the user watches it being written and scrolling down in real time.
  const shownCount = shownOps?.length ?? 0;
  useEffect(() => {
    if (!isPending) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [isPending, shownCount]);

  const lineColor = (op: DiffOp) => {
    if (op.type === 'add') return 'var(--green-text, #4ade80)';
    if (op.type === 'remove') return 'var(--red-text, #ff6b6b)';
    return 'var(--text-ghost)';
  };

  const lineBg = (op: DiffOp) => {
    if (op.type === 'add') return 'var(--green-subtle-bg, rgba(34,197,94,0.06))';
    if (op.type === 'remove') return 'var(--red-subtle-bg, rgba(239,68,68,0.06))';
    return 'transparent';
  };

  return (
    <div
      style={{
        borderRadius: 10,
        // Once a write is completed the box collapses to a compact rounded pill
        // (like the other activity rows): lighter border, no filled body.
        border: showBody ? '1px solid var(--border-default)' : '1px solid var(--border-subtle, var(--border-default))',
        background: 'var(--surface-0)',
        overflow: 'hidden',
        width: showBody ? '100%' : 'fit-content',
        maxWidth: '100%',
        marginTop: 4,
        marginBottom: 4,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px',
          height: 28,
          background: showBody ? 'var(--surface-1)' : 'transparent',
          borderBottom: showBody ? '1px solid var(--border-default)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {/* Code icon */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-ghost)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          {isPending || isWaiting ? (
            <span className="an-edit-shimmer" style={{ fontSize: 12 }}>{(isPending && isWrite && (diffOps?.length ?? 0) > 0) ? liveHeaderLabel : headerLabel}</span>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {headerLabel}
            </span>
          )}
        </div>
        {!isPending && !isWaiting && (displayAdded > 0 || displayRemoved > 0) && (
          <span style={{ fontSize: 11, fontFamily: 'monospace', display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 8 }}>
            {displayAdded > 0 && (
              <span style={{ color: 'var(--green-text, #4ade80)' }}>+{displayAdded}</span>
            )}
            {displayRemoved > 0 && (
              <span style={{ color: 'var(--red-text, #ff6b6b)' }}>-{displayRemoved}</span>
            )}
            {statsText && (
              <span style={{ color: 'var(--text-ghost)' }}>{statsText}</span>
            )}
          </span>
        )}
        {isPending && (
          <span style={{ display: 'inline-flex', gap: 2, fontSize: 14, color: 'var(--text-ghost)' }}>
            <span className="an-edit-dot">.</span>
            <span className="an-edit-dot">.</span>
            <span className="an-edit-dot">.</span>
          </span>
        )}
      </div>

      {/* Code body */}
      {showBody && shownOps && shownOps.length > 0 && (
        <div ref={bodyRef} style={{
          fontSize: 12,
          fontFamily: '"SF Mono", "Fira Code", "JetBrains Mono", monospace',
          lineHeight: 1.5,
          background: 'var(--surface-0)',
          // While streaming: fixed-height rectangle, code scrolls DOWN only —
          // no horizontal scroll, no resize. For completed edits: normal scroll.
          overflowX: 'hidden',
          overflowY: isPending ? 'hidden' : 'auto',
          height: isPending ? 260 : undefined,
          maxHeight: isPending ? 260 : (expanded ? 'none' : 450),
          scrollBehavior: 'smooth',
        }}>
          {shownOps.map((op, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                minWidth: 0,
                background: lineBg(op),
              }}
            >
              {/* +/- sign */}
              <span style={{
                userSelect: 'none',
                width: 16,
                textAlign: 'center',
                flexShrink: 0,
                color: lineColor(op),
              }}>
                {op.type === 'add' ? '+' : op.type === 'remove' ? '-' : ' '}
              </span>
              {/* Code content — wraps (no horizontal scroll) */}
              <span style={{
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                paddingRight: 8,
                flex: 1,
                minWidth: 0,
                color: op.type === 'context' ? 'var(--text-secondary)' : 'var(--text-secondary)',
              }}>
                {op.text || ' '}
                {isPending && i === shownOps.length - 1 && <span className="an-edit-caret" />}
              </span>
            </div>
          ))}

          {/* Show more / Collapse */}
          {!isPending && hasMore && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 0',
                fontSize: 11,
                color: 'var(--blue-accent)',
                background: 'var(--surface-1)',
                border: 'none',
                borderTop: '1px solid var(--border-default)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Show {diffOps!.length - displayOps!.length} more lines
            </button>
          )}
          {expanded && hasMore && (
            <button
              onClick={() => setExpanded(false)}
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 0',
                fontSize: 11,
                color: 'var(--blue-accent)',
                background: 'var(--surface-1)',
                border: 'none',
                borderTop: '1px solid var(--border-default)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Collapse
            </button>
          )}
        </div>
      )}
    </div>
  );
});
