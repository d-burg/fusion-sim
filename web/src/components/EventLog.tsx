import { useEffect, useRef, useState } from 'react'
import type { LogEvent, ReportRow, Severity } from '../lib/pulseLog'
import InfoPopup from './InfoPopup'
import { safeGet, safeSet } from '../lib/safeStorage'
import { eventLogInfo } from './infoContent'

interface Props {
  events: LogEvent[]
  pulseNumber: number | null
  running: boolean
  /** Achieved-versus-programmed rows; null until the pulse has finished. */
  report: ReportRow[] | null
}

const OPEN_KEY = 'tok-sym-log-open'

function initialOpen(): boolean {
  const stored = safeGet(OPEN_KEY)
  if (stored === '1') return true
  if (stored === '0') return false
  // Default open only where the grid can spare the height: the status panel
  // needs about 380 px, which a 900 px window gives it only with the log
  // collapsed to its single status line.
  return typeof window !== 'undefined' && window.matchMedia('(min-height: 64rem)').matches
}

const SEV_COLOR: Record<Severity, string> = {
  info: 'var(--c-ink-dim)',
  ok: 'var(--c-ok)',
  minor: 'var(--c-warn)',
  major: 'var(--c-bad-ink)',
  invalid: 'var(--c-invalid)',
}
const SEV_TAG: Partial<Record<Severity, string>> = {
  minor: 'MINOR',
  major: 'MAJOR',
  invalid: 'INVALID',
}

/**
 * Append-only control-room event log as a strip under the main grid, with
 * the end-of-pulse report in the same space once the pulse has finished.
 * Collapsed, it shows only the pulse number and the latest event. The parent
 * keys it by pulse number, so the Log/Report choice resets with each pulse.
 */
export default function EventLog({ events, pulseNumber, running, report }: Props) {
  const [open, setOpen] = useState<boolean>(initialOpen)
  const [view, setView] = useState<'log' | 'report'>('log')
  const listRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true) // follow the newest event unless the user scrolled up

  // Persist only an explicit choice; the height-based default is re-evaluated
  // on each visit so a laptop does not inherit a tall monitor's setting.
  const toggleOpen = () => {
    setOpen((v) => {
      safeSet(OPEN_KEY, v ? '0' : '1')
      return !v
    })
  }

  // Follow the tail while running. A freshly mounted list (after collapse /
  // expand or Report → Log) starts at the tail again.
  useEffect(() => { stickRef.current = true }, [open, view])
  useEffect(() => {
    const el = listRef.current
    if (!el || !stickRef.current) return
    el.scrollTop = el.scrollHeight
  }, [events.length, open, view])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
  }

  const latest = events.length > 0 ? events[events.length - 1] : null
  const showReport = view === 'report' && report !== null

  return (
    <div className="shrink-0 border-t border-[var(--c-line)] bg-[var(--c-surface)] text-xs">
      {/* Header row: always visible */}
      <div className="flex items-center gap-2 px-3 h-7">
        <span className="panel-title flex items-center gap-1 shrink-0">
          Event log
          <InfoPopup title="Event Log" position="right">{eventLogInfo}</InfoPopup>
        </span>
        <span className="text-[var(--c-ink-faint)] shrink-0 whitespace-nowrap">
          Pulse <span className="font-mono tabular-nums text-[var(--c-ink-dim)]">{pulseNumber ?? '—'}</span>
        </span>

        {/* Collapsed: the latest event inline */}
        {!open && latest && (
          <span className="flex items-center gap-2 min-w-0 flex-1">
            <EventLine ev={latest} compact />
          </span>
        )}
        {open && <span className="flex-1" />}

        {/* Log / Report switch, only once there is a report */}
        {report !== null && open && (
          <div className="flex rounded overflow-hidden border border-[var(--c-line-strong)] shrink-0">
            {(['log', 'report'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2 py-0.5 text-xs transition-colors cursor-pointer ${
                  view === v
                    ? 'bg-[var(--c-raised)] text-[var(--c-ink)]'
                    : 'bg-transparent text-[var(--c-ink-faint)] hover:text-[var(--c-ink)]'
                }`}
              >
                {v === 'log' ? 'Log' : 'Report'}
              </button>
            ))}
          </div>
        )}
        {report !== null && !open && (
          <button
            onClick={() => { setOpen(true); setView('report') }}
            className="px-2 py-0.5 text-xs rounded border border-[var(--c-line-strong)]
                       text-[var(--c-ink-dim)] hover:text-[var(--c-ink)] transition-colors cursor-pointer shrink-0"
          >
            Report
          </button>
        )}

        <button
          onClick={toggleOpen}
          aria-expanded={open}
          aria-label={open ? 'Collapse event log' : 'Expand event log'}
          className="shrink-0 w-6 h-5 flex items-center justify-center rounded
                     text-[var(--c-ink-faint)] hover:text-[var(--c-ink)] hover:bg-[var(--c-raised)]
                     transition-colors cursor-pointer"
        >
          <svg className={`w-3 h-3 transition-transform ${open ? '' : 'rotate-180'}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <path d="M2 4.5 6 8.5 10 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Body */}
      {open && (
        showReport ? (
          <ReportTable rows={report} />
        ) : (
          <div
            ref={listRef}
            onScroll={onScroll}
            className="h-[7.25rem] overflow-y-auto px-3 pb-1 border-t border-[var(--c-line)]"
          >
            {events.length === 0 ? (
              <div className="text-[var(--c-ink-faint)] pt-1">
                {running ? 'Waiting for the first event…' : 'No events yet. Start the pulse.'}
              </div>
            ) : (
              events.map((ev) => (
                <div key={ev.id} className="flex items-baseline gap-2 py-px leading-[1.15rem]">
                  <EventLine ev={ev} />
                </div>
              ))
            )}
          </div>
        )
      )}
    </div>
  )
}

function EventLine({ ev, compact = false }: { ev: LogEvent; compact?: boolean }) {
  const tag = SEV_TAG[ev.severity]
  const color = SEV_COLOR[ev.severity]
  const textColor = ev.severity === 'info' ? 'var(--c-ink-dim)' : 'var(--c-ink)'
  return (
    <>
      <span className="font-mono tabular-nums text-[var(--c-ink-faint)] w-[4.25em] text-right shrink-0">
        {ev.t.toFixed(3)}
      </span>
      {/* Fixed-width tag slot so the text column lines up with or without a tag */}
      <span
        className="w-[4.6em] shrink-0 text-[10px] uppercase tracking-wider font-medium"
        style={{ color }}
      >
        {tag ?? (ev.severity === 'ok' ? '' : '')}
        {!tag && ev.severity === 'ok' && (
          <span className="inline-block w-1.5 h-1.5 rounded-full align-middle" style={{ backgroundColor: color }} />
        )}
      </span>
      <span className={`min-w-0 ${compact ? 'truncate' : ''}`} style={{ color: textColor }}>
        {ev.text}
        {!compact && ev.detail && (
          <span className="block text-[var(--c-ink-faint)]">{ev.detail}</span>
        )}
      </span>
    </>
  )
}

function ReportTable({ rows }: { rows: ReportRow[] }) {
  const statusColor = (s?: ReportRow['status']) =>
    s === 'major' ? 'var(--c-bad-ink)' : s === 'minor' ? 'var(--c-warn)' : 'var(--c-ink)'
  return (
    <div className="h-[7.25rem] overflow-y-auto px-3 py-1 border-t border-[var(--c-line)]">
      <div className="grid grid-cols-2 gap-x-6 gap-y-px">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline gap-2 leading-[1.15rem]">
            <span className="text-[var(--c-ink-faint)] whitespace-nowrap">{r.label}</span>
            <span className="flex-1 border-b border-dotted border-[var(--c-line)] translate-y-[-0.2em]" aria-hidden="true" />
            {r.programmed && (
              <span className="font-mono tabular-nums text-[var(--c-ink-faint)] whitespace-nowrap">
                {r.programmed} <span className="font-sans">→</span>
              </span>
            )}
            <span className="font-mono tabular-nums whitespace-nowrap" style={{ color: statusColor(r.status) }}>
              {r.achieved}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
