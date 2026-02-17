/**
 * Predictive Context Engine Panel
 *
 * Inhomogeneous Hawkes Process with Contextual Covariates
 * Event Calendar · Seasonal Decomposition · Campaign Recurrence · Forecast · Backtest
 *
 * Architecture: Predictive_Context_Engine_Architecture.docx (Feb 2026)
 */

import { useState, useMemo, useEffect } from 'react';

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────
const C = {
  bg: 'rgba(8, 15, 28, 0.97)',
  border: 'rgba(0, 180, 255, 0.18)',
  tabActive: '#6366f1',
  text: '#e0eaf8',
  muted: '#5a7da8',
  accent: '#00ccff',
  panel: 'rgba(10, 20, 40, 0.85)',
  mono: "'JetBrains Mono', 'Fira Code', monospace",
};

const CATEGORY_COLORS: Record<string, string> = {
  sporting:      '#3b82f6', // blue
  commerce:      '#22c55e', // green
  geopolitical:  '#ef4444', // red
  vulnerability: '#f97316', // orange
  financial:     '#eab308', // yellow
  holiday:       '#a855f7', // purple
};

const VECTOR_COLORS: Record<string, string> = {
  ssh:        '#00e5ff',
  rdp:        '#ff6d00',
  http:       '#b388ff',
  dns_amp:    '#76ff03',
  brute_force:'#ff4081',
  botnet_c2:  '#ffd740',
  ransomware: '#ff1744',
};

// ─── SOURCE ATTRIBUTION ────────────────────────────────────────────────────

const SOURCE_COLORS: Record<string, string> = {
  'DShield':         '#00ccff',
  'GreyNoise':       '#a855f7',
  'Abuse.ch':        '#f97316',
  'HawkesParam DB':  '#22c55e',
  'MITRE ATT&CK':    '#ef4444',
  'STL Decomp':      '#eab308',
  'Architecture Doc':'#5a7da8',
  'Historical Data': '#64748b',
};

function DataSourceChips({ sources, label }: { sources: string[]; label?: string }) {
  if (!sources.length) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', marginTop: '6px' }}>
      {label && (
        <span style={{ fontFamily: C.mono, fontSize: '8px', color: C.muted, letterSpacing: '0.08em' }}>
          {label}:
        </span>
      )}
      {sources.map(s => (
        <span key={s} style={{
          padding: '1px 7px', borderRadius: '10px',
          background: `${SOURCE_COLORS[s] ?? '#5a7da8'}12`,
          border: `1px solid ${SOURCE_COLORS[s] ?? '#5a7da8'}30`,
          color: SOURCE_COLORS[s] ?? C.muted,
          fontFamily: C.mono, fontSize: '8px', letterSpacing: '0.06em',
        }}>
          ◈ {s}
        </span>
      ))}
    </div>
  );
}

// ─── LIVE DATA INTERFACES ──────────────────────────────────────────────────

interface LiveEvent extends CalendarEvent {
  source?: string;
  source_url?: string;
  data_sources?: string[];
}

interface ForecastPoint {
  date: string;
  mu_base: number;
  s_t: number;
  event_mult: number;
  campaign_mult: number;
  mu_t: number;
}

interface LiveForecastData {
  vector: string;
  mu_base: number;
  is_live: boolean;
  data_sources: string[];
  series: ForecastPoint[];
  seasonal_now: number;
  campaign_now: number;
  event_now: number;
}

interface LiveCampaignGroup extends CampaignGroup {
  mitre_id?: string;
  source_url?: string;
}

interface LiveSeasonalData {
  vectors: Record<string, { monthly: number[]; current_s_t: number; data_sources: string[] }>;
  data_sources: string[];
}

// ─── MOCK DATA ─────────────────────────────────────────────────────────────

const NOW = new Date('2026-02-16');

// § 2: Event Calendar
interface CalendarEvent {
  id: string;
  name: string;
  category: string;
  startDate: string; // ISO date
  endDate: string;
  leadDays: number;
  lagDays: number;
  region: string;
  impactWeight: number;
  vectors: string[];
  description: string;
  confidence: number;
}

const EVENTS: CalendarEvent[] = [
  {
    id: 'patch-tue-feb-2026',
    name: 'Patch Tuesday — February 2026',
    category: 'vulnerability',
    startDate: '2026-02-10',
    endDate: '2026-02-10',
    leadDays: 0,
    lagDays: 30,
    region: 'global',
    impactWeight: 0.45,
    vectors: ['http', 'ssh', 'rdp'],
    description: 'Microsoft February Patch Tuesday. Exploitation lag window active through ~March 12.',
    confidence: 0.92,
  },
  {
    id: 'fifa-wc-2026',
    name: 'FIFA World Cup 2026',
    category: 'sporting',
    startDate: '2026-06-11',
    endDate: '2026-07-19',
    leadDays: 7,
    lagDays: 3,
    region: 'north_america',
    impactWeight: 0.62,
    vectors: ['http', 'dns_amp', 'brute_force'],
    description: 'US/Canada/Mexico-hosted World Cup. 600% phishing spike modelled on 2022 Qatar patterns. Ticketing fraud, credential stuffing, streaming DDoS.',
    confidence: 0.85,
  },
  {
    id: 'patch-tue-mar-2026',
    name: 'Patch Tuesday — March 2026',
    category: 'vulnerability',
    startDate: '2026-03-10',
    endDate: '2026-03-10',
    leadDays: 0,
    lagDays: 30,
    region: 'global',
    impactWeight: 0.45,
    vectors: ['http', 'ssh', 'rdp'],
    description: 'Microsoft March Patch Tuesday. Reverse-engineering and weaponization window.',
    confidence: 0.92,
  },
  {
    id: 'tax-deadline-us-2026',
    name: 'US Tax Filing Deadline',
    category: 'financial',
    startDate: '2026-04-15',
    endDate: '2026-04-15',
    leadDays: 14,
    lagDays: 7,
    region: 'north_america',
    impactWeight: 0.38,
    vectors: ['http', 'brute_force', 'ssh'],
    description: 'BEC and phishing campaigns peak 2 weeks prior. Wire fraud, fake IRS emails, credential harvesting.',
    confidence: 0.78,
  },
  {
    id: 'defcon-34-2026',
    name: 'DEF CON 34',
    category: 'vulnerability',
    startDate: '2026-08-06',
    endDate: '2026-08-09',
    leadDays: 0,
    lagDays: 30,
    region: 'north_america',
    impactWeight: 0.55,
    vectors: ['ssh', 'http', 'rdp'],
    description: 'New tool and PoC releases drive scanning within 48h. Extended exploitation window post-conference.',
    confidence: 0.88,
  },
  {
    id: 'us-midterms-2026',
    name: 'US Midterm Elections 2026',
    category: 'geopolitical',
    startDate: '2026-11-03',
    endDate: '2026-11-03',
    leadDays: 30,
    lagDays: 14,
    region: 'north_america',
    impactWeight: 0.72,
    vectors: ['ssh', 'http', 'dns_amp', 'botnet_c2'],
    description: 'State-sponsored infrastructure probing 30+ days ahead of election. Election system targeting, disinformation infrastructure.',
    confidence: 0.82,
  },
  {
    id: 'black-friday-2026',
    name: 'Black Friday / Cyber Monday 2026',
    category: 'commerce',
    startDate: '2026-11-27',
    endDate: '2026-11-30',
    leadDays: 5,
    lagDays: 14,
    region: 'global',
    impactWeight: 0.68,
    vectors: ['http', 'brute_force', 'botnet_c2'],
    description: '3.6B bot requests in 48h (Imperva 2024 baseline). Payment skimming, fake storefronts, credential stuffing. 4× credential stuffing vs. baseline.',
    confidence: 0.91,
  },
  {
    id: 'holiday-season-2026',
    name: 'Holiday Season 2026',
    category: 'holiday',
    startDate: '2026-12-24',
    endDate: '2026-12-26',
    leadDays: 3,
    lagDays: 3,
    region: 'global',
    impactWeight: 0.58,
    vectors: ['ransomware', 'ssh', 'rdp', 'botnet_c2'],
    description: 'Skeleton crew exploitation window. 68% of major ransomware incidents target weekends/holidays (Semperis). Christmas week is peak ransomware deployment.',
    confidence: 0.89,
  },
];

// § 3: Seasonal multipliers (from architecture doc tables)
const SEASONAL_DATA: Record<string, number[]> = {
  // [Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec]
  ssh:        [1.05, 1.02, 1.00, 0.98, 0.92, 0.88, 0.84, 0.86, 0.95, 1.05, 1.25, 1.30],
  rdp:        [1.08, 1.05, 1.00, 0.95, 0.88, 0.83, 0.80, 0.85, 0.95, 1.10, 1.20, 1.35],
  http:       [0.95, 0.85, 0.95, 1.10, 1.05, 1.00, 0.92, 0.95, 1.00, 1.05, 1.30, 1.15],
  dns_amp:    [0.80, 0.88, 1.15, 1.05, 1.10, 1.20, 1.10, 1.05, 1.00, 0.95, 0.92, 0.90],
};

const DOW_MULTIPLIERS = [
  { day: 'Mon', mult: 1.05 },
  { day: 'Tue', mult: 1.08 },
  { day: 'Wed', mult: 1.15 },
  { day: 'Thu', mult: 1.05 },
  { day: 'Fri', mult: 1.00 },
  { day: 'Sat', mult: 0.88 },
  { day: 'Sun', mult: 0.82 },
];

// § 4: Campaign recurrence (monthly intensity per APT group)
interface CampaignGroup {
  name: string;
  origin: string;
  primaryVectors: string[];
  monthlyIntensity: number[]; // 12 values, normalized ~1.0
  confidence: number;
  campaigns: number;
}

const CAMPAIGN_GROUPS: CampaignGroup[] = [
  {
    name: 'APT28 (Fancy Bear)',
    origin: 'Russia',
    primaryVectors: ['ssh', 'http', 'botnet_c2'],
    monthlyIntensity: [1.35, 1.40, 1.10, 0.90, 0.85, 0.80, 0.75, 0.90, 1.20, 1.35, 1.40, 1.10],
    confidence: 0.88,
    campaigns: 47,
  },
  {
    name: 'Lazarus Group',
    origin: 'North Korea',
    primaryVectors: ['http', 'ransomware', 'botnet_c2'],
    monthlyIntensity: [0.90, 1.45, 1.10, 0.85, 0.80, 0.90, 0.85, 1.20, 1.25, 1.00, 0.95, 0.85],
    confidence: 0.82,
    campaigns: 38,
  },
  {
    name: 'APT41',
    origin: 'China',
    primaryVectors: ['ssh', 'http', 'rdp'],
    monthlyIntensity: [1.20, 1.30, 1.00, 0.90, 1.15, 1.10, 0.85, 0.80, 1.00, 1.05, 1.10, 1.25],
    confidence: 0.79,
    campaigns: 52,
  },
  {
    name: 'Conti Successor',
    origin: 'Russia/Eastern Europe',
    primaryVectors: ['ransomware', 'rdp', 'ssh'],
    monthlyIntensity: [1.30, 1.10, 0.95, 0.85, 0.90, 0.88, 0.80, 0.82, 0.95, 1.05, 1.25, 1.45],
    confidence: 0.75,
    campaigns: 29,
  },
  {
    name: 'Turla',
    origin: 'Russia / FSB',
    primaryVectors: ['ssh', 'botnet_c2', 'http'],
    monthlyIntensity: [0.95, 1.05, 0.90, 0.85, 0.80, 0.88, 0.90, 1.00, 1.20, 1.25, 1.15, 1.10],
    confidence: 0.76,
    campaigns: 31,
  },
];

// § 5: Backtest results
const BACKTEST_MODELS = [
  { model: 'Baseline Hawkes (μ constant)', mape: 0.34, coverage: 0.77, brier: 0.28, aic: 4820, dm_p: null, color: '#5a7da8' },
  { model: '+ Seasonal S(t)',              mape: 0.25, coverage: 0.84, brier: 0.22, aic: 4310, dm_p: 0.012, color: '#22c55e' },
  { model: '+ Events E(t)',                mape: 0.21, coverage: 0.87, brier: 0.18, aic: 4010, dm_p: 0.006, color: '#f97316' },
  { model: '+ Campaigns C(t)  [Full]',     mape: 0.17, coverage: 0.90, brier: 0.14, aic: 3880, dm_p: 0.002, color: '#6366f1' },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────

function isEventActive(ev: CalendarEvent): boolean {
  const s = new Date(ev.startDate);
  const e = new Date(ev.endDate);
  const start = new Date(s.getTime() - ev.leadDays * 86400000);
  const end   = new Date(e.getTime() + ev.lagDays  * 86400000);
  return NOW >= start && NOW <= end;
}

function isEventUpcoming(ev: CalendarEvent): boolean {
  const s = new Date(ev.startDate);
  const windowStart = new Date(s.getTime() - ev.leadDays * 86400000);
  return windowStart > NOW;
}

function daysUntilActive(ev: CalendarEvent): number {
  const s = new Date(ev.startDate);
  const windowStart = new Date(s.getTime() - ev.leadDays * 86400000);
  return Math.ceil((windowStart.getTime() - NOW.getTime()) / 86400000);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function heatColor(mult: number): string {
  // 0.75 (teal) → 1.0 (white) → 1.35 (red)
  if (mult < 1.0) {
    const t = (mult - 0.75) / 0.25;
    const r = Math.round(0 + t * 30);
    const g = Math.round(200 + t * 55);
    const b = Math.round(255 - t * 55);
    return `rgba(${r},${g},${b},0.7)`;
  }
  const t = Math.min(1, (mult - 1.0) / 0.35);
  const r = Math.round(30 + t * 225);
  const g = Math.round(255 - t * 205);
  const b = Math.round(200 - t * 200);
  return `rgba(${r},${g},${b},0.8)`;
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────

function EventCalendarTab({ events, dataSources }: { events?: LiveEvent[]; dataSources?: string[] }) {
  const [filter, setFilter] = useState<string>('all');
  const categories = ['all', 'sporting', 'commerce', 'geopolitical', 'vulnerability', 'financial', 'holiday'];
  const source = events && events.length > 0 ? events : EVENTS as LiveEvent[];

  const filtered = useMemo(() => {
    const evs = filter === 'all' ? source : source.filter(e => e.category === filter);
    return [...evs].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
  }, [filter, source]);

  return (
    <div>
      {/* Panel-level data source attribution */}
      <DataSourceChips
        sources={dataSources ?? ['Architecture Doc', 'Historical Data']}
        label="DATA SOURCES"
      />

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px', marginTop: '12px' }}>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            style={{
              padding: '3px 10px',
              borderRadius: '12px',
              border: `1px solid ${cat === 'all' ? C.accent : CATEGORY_COLORS[cat] || C.border}`,
              background: filter === cat ? (cat === 'all' ? `${C.accent}20` : `${CATEGORY_COLORS[cat]}20`) : 'transparent',
              color: filter === cat ? (cat === 'all' ? C.accent : CATEGORY_COLORS[cat]) : C.muted,
              fontFamily: C.mono,
              fontSize: '10px',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Event cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {filtered.map(ev => {
          const active = isEventActive(ev);
          const upcoming = isEventUpcoming(ev);
          const catColor = CATEGORY_COLORS[ev.category] || C.accent;
          const dtu = upcoming ? daysUntilActive(ev) : null;

          return (
            <div
              key={ev.id}
              style={{
                background: active ? `${catColor}08` : 'rgba(255,255,255,0.02)',
                border: `1px solid ${active ? catColor + '40' : C.border}`,
                borderLeft: `3px solid ${catColor}`,
                borderRadius: '6px',
                padding: '12px 14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    padding: '2px 7px', borderRadius: '10px',
                    background: `${catColor}20`, border: `1px solid ${catColor}40`,
                    color: catColor, fontFamily: C.mono, fontSize: '9px',
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                  }}>
                    {ev.category}
                  </span>
                  <span style={{ fontFamily: C.mono, fontSize: '12px', fontWeight: 600, color: C.text }}>
                    {ev.name}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {active && (
                    <span style={{
                      padding: '2px 8px', borderRadius: '10px',
                      background: '#22c55e20', border: '1px solid #22c55e50',
                      color: '#22c55e', fontFamily: C.mono, fontSize: '9px',
                      letterSpacing: '0.08em', animation: 'pulse-dot 2s ease-in-out infinite',
                    }}>
                      ◉ ACTIVE
                    </span>
                  )}
                  {upcoming && dtu !== null && dtu <= 45 && (
                    <span style={{ fontFamily: C.mono, fontSize: '9px', color: C.muted }}>
                      T–{dtu}d
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '24px', marginBottom: '6px' }}>
                <div>
                  <div style={{ fontFamily: C.mono, fontSize: '9px', color: C.muted, letterSpacing: '0.1em', marginBottom: '2px' }}>WINDOW</div>
                  <div style={{ fontFamily: C.mono, fontSize: '10px', color: C.text }}>
                    {formatDate(ev.startDate)}
                    {ev.startDate !== ev.endDate && ` → ${formatDate(ev.endDate)}`}
                    <span style={{ color: C.muted }}> (lead {ev.leadDays}d / lag {ev.lagDays}d)</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: C.mono, fontSize: '9px', color: C.muted, letterSpacing: '0.1em', marginBottom: '2px' }}>UPLIFT wᵢ</div>
                  <div style={{ fontFamily: C.mono, fontSize: '11px', color: catColor, fontWeight: 700 }}>
                    +{(ev.impactWeight * 100).toFixed(0)}%
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: C.mono, fontSize: '9px', color: C.muted, letterSpacing: '0.1em', marginBottom: '2px' }}>REGION</div>
                  <div style={{ fontFamily: C.mono, fontSize: '10px', color: C.text }}>
                    {ev.region.replace('_', ' ').toUpperCase()}
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: C.mono, fontSize: '9px', color: C.muted, letterSpacing: '0.1em', marginBottom: '2px' }}>CONF</div>
                  <div style={{ fontFamily: C.mono, fontSize: '10px', color: C.text }}>
                    {(ev.confidence * 100).toFixed(0)}%
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
                {ev.vectors.map(v => (
                  <span key={v} style={{
                    padding: '1px 7px', borderRadius: '10px',
                    background: `${VECTOR_COLORS[v] || C.accent}18`,
                    border: `1px solid ${VECTOR_COLORS[v] || C.accent}40`,
                    color: VECTOR_COLORS[v] || C.accent,
                    fontFamily: C.mono, fontSize: '9px', textTransform: 'uppercase',
                  }}>
                    {v.replace('_', ' ')}
                  </span>
                ))}
              </div>

              <div style={{ fontFamily: C.mono, fontSize: '10px', color: C.muted, lineHeight: 1.5 }}>
                {ev.description}
              </div>

              {/* Per-event data source chips */}
              {(ev as LiveEvent).data_sources && (
                <DataSourceChips sources={(ev as LiveEvent).data_sources!} label="SRC" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SeasonalHeatmapTab({ liveData }: { liveData?: LiveSeasonalData }) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const currentMonth = NOW.getMonth(); // 0-indexed

  // Use live monthly values if available, else fall back to seed constants
  const displayData: Record<string, number[]> = liveData
    ? Object.fromEntries(
        Object.entries(liveData.vectors).map(([v, info]) => [v, info.monthly])
      )
    : SEASONAL_DATA;

  const topSources = liveData?.data_sources ?? ['STL Decomp', 'Architecture Doc'];

  return (
    <div>
      <DataSourceChips sources={topSources} label="DATA SOURCES" />
      <div style={{ fontFamily: C.mono, fontSize: '10px', color: C.muted, marginBottom: '16px', marginTop: '10px', lineHeight: 1.6 }}>
        STL seasonal decomposition — multiplicative factor S(t) per vector per month.
        Values &gt;1.0 indicate above-baseline background rate. Current month highlighted.
      </div>

      {/* Monthly heatmap */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ fontFamily: C.mono, fontSize: '9px', color: C.muted, letterSpacing: '0.12em', marginBottom: '8px' }}>
          MONTHLY SEASONAL MULTIPLIER S(t)
        </div>

        {/* Month header */}
        <div style={{ display: 'grid', gridTemplateColumns: '80px repeat(12, 1fr)', gap: '2px', marginBottom: '4px' }}>
          <div />
          {MONTHS.map((m, i) => (
            <div key={m} style={{
              fontFamily: C.mono, fontSize: '9px',
              color: i === currentMonth ? C.accent : C.muted,
              textAlign: 'center', fontWeight: i === currentMonth ? 700 : 400,
            }}>
              {m}
            </div>
          ))}
        </div>

        {/* Rows */}
        {Object.entries(displayData).map(([vector, mults]) => (
          <div key={vector} style={{ display: 'grid', gridTemplateColumns: '80px repeat(12, 1fr)', gap: '2px', marginBottom: '2px' }}>
            <div style={{
              fontFamily: C.mono, fontSize: '10px',
              color: VECTOR_COLORS[vector] || C.accent,
              textTransform: 'uppercase', display: 'flex', alignItems: 'center',
            }}>
              {vector.replace('_', ' ')}
            </div>
            {mults.map((m, i) => (
              <div
                key={i}
                style={{
                  background: heatColor(m),
                  borderRadius: '3px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: C.mono,
                  fontSize: '9px',
                  color: 'rgba(0,0,0,0.8)',
                  fontWeight: i === currentMonth ? 800 : 600,
                  outline: i === currentMonth ? '1px solid rgba(255,255,255,0.6)' : 'none',
                }}
              >
                {m.toFixed(2)}
              </div>
            ))}
          </div>
        ))}

        {/* Color scale legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
          <span style={{ fontFamily: C.mono, fontSize: '8px', color: C.muted }}>0.75</span>
          <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: 'linear-gradient(90deg, rgba(0,220,255,0.7), rgba(30,255,200,0.7), rgba(255,200,0,0.7), rgba(255,50,0,0.8))' }} />
          <span style={{ fontFamily: C.mono, fontSize: '8px', color: C.muted }}>1.35</span>
          <span style={{ fontFamily: C.mono, fontSize: '8px', color: C.muted }}>MULTIPLIER</span>
        </div>
      </div>

      {/* Day-of-week effect */}
      <div>
        <div style={{ fontFamily: C.mono, fontSize: '9px', color: C.muted, letterSpacing: '0.12em', marginBottom: '10px' }}>
          DAY-OF-WEEK EFFECT (enterprise-targeting vectors)
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', height: '80px' }}>
          {DOW_MULTIPLIERS.map(({ day, mult }) => {
            const barH = Math.round((mult / 1.15) * 72);
            const barColor = mult >= 1.10 ? '#ef4444' : mult >= 1.00 ? '#f97316' : '#5a7da8';
            return (
              <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                <div style={{ fontFamily: C.mono, fontSize: '9px', color: barColor }}>{mult.toFixed(2)}</div>
                <div style={{
                  width: '100%', height: `${barH}px`,
                  background: barColor,
                  borderRadius: '3px 3px 0 0',
                  opacity: 0.8,
                }} />
                <div style={{ fontFamily: C.mono, fontSize: '9px', color: C.muted }}>{day}</div>
              </div>
            );
          })}
        </div>
        <div style={{ fontFamily: C.mono, fontSize: '9px', color: C.muted, marginTop: '8px' }}>
          Note: Ransomware vectors reverse this pattern — Sat–Sun = peak deployment window
        </div>
      </div>
    </div>
  );
}

function CampaignRecurrenceTab({ groups, dataSources }: { groups?: LiveCampaignGroup[]; dataSources?: string[] }) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const currentMonth = NOW.getMonth(); // 0-indexed
  const source = groups && groups.length > 0 ? groups : CAMPAIGN_GROUPS as LiveCampaignGroup[];

  // Sort by intensity at current month (most active first)
  const sorted = [...source].sort(
    (a, b) => b.monthlyIntensity[currentMonth] - a.monthlyIntensity[currentMonth]
  );

  return (
    <div>
      <DataSourceChips
        sources={dataSources ?? ['MITRE ATT&CK', 'Historical Data', 'Architecture Doc']}
        label="DATA SOURCES"
      />
      <div style={{ fontFamily: C.mono, fontSize: '10px', color: C.muted, marginBottom: '16px', marginTop: '10px', lineHeight: 1.6 }}>
        Von Mises circular KDE over attributed campaign timestamps. C(t) = weighted average across groups,
        normalized so mean = 1.0. Groups ranked by activity at current month ({MONTHS[currentMonth]}).
      </div>

      {/* Active this month callout */}
      <div style={{
        padding: '10px 14px', borderRadius: '6px', marginBottom: '16px',
        background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)',
      }}>
        <div style={{ fontFamily: C.mono, fontSize: '9px', color: '#6366f1', letterSpacing: '0.1em', marginBottom: '6px' }}>
          ◈ CAMPAIGN PRIOR C(t) — {MONTHS[currentMonth].toUpperCase()} 2026
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {sorted.filter(g => g.monthlyIntensity[currentMonth] >= 1.0).map(g => (
            <span key={g.name} style={{
              padding: '2px 8px', borderRadius: '10px',
              background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.4)',
              fontFamily: C.mono, fontSize: '9px', color: '#a5b4fc',
            }}>
              {g.name.split(' ')[0]} {g.name.split(' ')[1]}
              {' '}
              <span style={{ color: '#6366f1' }}>×{g.monthlyIntensity[currentMonth].toFixed(2)}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Per-group sparklines */}
      {sorted.map(g => {
        const peak = Math.max(...g.monthlyIntensity);
        const currentVal = g.monthlyIntensity[currentMonth];

        return (
          <div key={g.name} style={{
            marginBottom: '12px', padding: '10px 14px',
            background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`,
            borderRadius: '6px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontFamily: C.mono, fontSize: '11px', fontWeight: 600, color: C.text }}>
                    {g.name}
                  </span>
                  {(g as LiveCampaignGroup).mitre_id && (
                    <span style={{
                      padding: '1px 6px', borderRadius: '8px',
                      background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                      color: '#ef4444', fontFamily: C.mono, fontSize: '8px', letterSpacing: '0.05em',
                    }}>
                      ◈ MITRE {(g as LiveCampaignGroup).mitre_id}
                    </span>
                  )}
                </div>
                <span style={{ fontFamily: C.mono, fontSize: '9px', color: C.muted }}>
                  {g.origin} · {g.campaigns} campaigns · conf {(g.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <span style={{
                fontFamily: C.mono, fontSize: '11px', fontWeight: 700,
                color: currentVal >= 1.2 ? '#ef4444' : currentVal >= 1.0 ? '#f97316' : C.muted,
              }}>
                C(t)={currentVal.toFixed(2)}
              </span>
            </div>

            {/* Monthly bar chart */}
            <div style={{ display: 'flex', gap: '3px', alignItems: 'flex-end', height: '40px' }}>
              {g.monthlyIntensity.map((val, i) => {
                const barH = Math.round((val / (peak * 1.1)) * 36);
                const isCurrent = i === currentMonth;
                const barColor = val >= 1.2 ? '#ef4444' : val >= 1.0 ? '#6366f1' : '#5a7da8';
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                    <div style={{
                      width: '100%', height: `${barH}px`,
                      background: barColor,
                      borderRadius: '2px 2px 0 0',
                      opacity: isCurrent ? 1 : 0.6,
                      outline: isCurrent ? '1px solid rgba(255,255,255,0.6)' : 'none',
                    }} />
                    <div style={{ fontFamily: C.mono, fontSize: '7px', color: isCurrent ? C.accent : C.muted }}>
                      {MONTHS[i].slice(0, 1)}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Vectors */}
            <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
              {g.primaryVectors.map(v => (
                <span key={v} style={{
                  padding: '1px 6px', borderRadius: '8px',
                  background: `${VECTOR_COLORS[v] || C.accent}15`,
                  border: `1px solid ${VECTOR_COLORS[v] || C.accent}30`,
                  color: VECTOR_COLORS[v] || C.accent,
                  fontFamily: C.mono, fontSize: '8px', textTransform: 'uppercase',
                }}>
                  {v.replace('_', ' ')}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ForecastTab({ liveData }: { liveData?: LiveForecastData }) {
  const DAYS = 30;
  const labels = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(NOW.getTime() + i * 86400000);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  const isLive = liveData?.is_live ?? false;
  const liveSources = liveData?.data_sources ?? ['Architecture Doc'];

  // Use real μ_base from DB if available, else seed value
  const muBase = liveData?.mu_base ?? 0.22;
  const forecast = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(NOW.getTime() + i * 86400000);
    const month = d.getMonth();
    const dow = d.getDay();
    const s_t = SEASONAL_DATA['ssh'][month];
    const dow_mult = DOW_MULTIPLIERS[dow].mult;

    // Check if any event is active on this day
    let eventUplift = 1.0;
    for (const ev of EVENTS) {
      const start = new Date(new Date(ev.startDate).getTime() - ev.leadDays * 86400000);
      const end   = new Date(new Date(ev.endDate).getTime() + ev.lagDays   * 86400000);
      if (d >= start && d <= end && ev.vectors.includes('ssh')) {
        eventUplift *= (1 + ev.impactWeight);
      }
    }

    // Campaign prior (APT28 active in Feb)
    const apt28 = CAMPAIGN_GROUPS[0].monthlyIntensity[month];
    const turla  = CAMPAIGN_GROUPS[4].monthlyIntensity[month];
    const c_t = (apt28 + turla) / 2;

    const mu_t = muBase * s_t * dow_mult * eventUplift * c_t;
    return {
      label: labels[i],
      mu_base: muBase,
      mu_seasonal: muBase * s_t * dow_mult,
      mu_context: mu_t,
      upliftPct: ((mu_t - muBase) / muBase * 100),
    };
  });

  const maxMu = Math.max(...forecast.map(f => f.mu_context)) * 1.1;
  const chartH = 120;
  const chartW = forecast.length;

  // SVG line chart
  const baselinePoints = forecast.map((f, i) =>
    `${(i / (chartW - 1)) * 100},${100 - (f.mu_base / maxMu) * 100}`
  ).join(' ');
  const seasonalPoints = forecast.map((f, i) =>
    `${(i / (chartW - 1)) * 100},${100 - (f.mu_seasonal / maxMu) * 100}`
  ).join(' ');
  const contextPoints = forecast.map((f, i) =>
    `${(i / (chartW - 1)) * 100},${100 - (f.mu_context / maxMu) * 100}`
  ).join(' ');

  const avgUplift = (forecast.reduce((s, f) => s + f.upliftPct, 0) / forecast.length).toFixed(1);

  return (
    <div>
      {/* Live / Seed data badge + source attribution */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <span style={{
          padding: '2px 10px', borderRadius: '10px',
          background: isLive ? 'rgba(34,197,94,0.12)' : 'rgba(90,125,168,0.12)',
          border: `1px solid ${isLive ? 'rgba(34,197,94,0.4)' : 'rgba(90,125,168,0.3)'}`,
          color: isLive ? '#22c55e' : '#5a7da8',
          fontFamily: C.mono, fontSize: '9px', letterSpacing: '0.1em',
          fontWeight: 700,
        }}>
          {isLive ? '◉ LIVE — HawkesParam DB' : '◎ SEED DATA'}
        </span>
        <DataSourceChips sources={liveSources} />
      </div>

      <div style={{ fontFamily: C.mono, fontSize: '10px', color: C.muted, marginBottom: '12px', lineHeight: 1.6 }}>
        30-day covariate-enhanced forecast for SSH — μ(t) = μ_base × S(t) × ∏(1 + wᵢEᵢ(t)) × C(t)
        {isLive && <span style={{ color: '#22c55e' }}> · μ_base sourced from live CTI ingest</span>}
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px', marginBottom: '16px' }}>
        {[
          { label: 'BASE RATE μ', value: muBase.toFixed(3), sub: isLive ? 'live avg (DB)' : 'events/hr', color: isLive ? '#22c55e' : '#5a7da8' },
          { label: 'SEASONAL S(t)', value: SEASONAL_DATA['ssh'][NOW.getMonth()].toFixed(3), sub: 'Feb multiplier', color: '#22c55e' },
          { label: 'AVG UPLIFT', value: `+${avgUplift}%`, sub: '30-day mean', color: '#6366f1' },
          { label: 'CAMPAIGN C(t)', value: CAMPAIGN_GROUPS[0].monthlyIntensity[NOW.getMonth()].toFixed(2), sub: 'APT28 (Feb)', color: '#f97316' },
        ].map(s => (
          <div key={s.label} style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`, borderRadius: '5px' }}>
            <div style={{ fontFamily: C.mono, fontSize: '8px', color: C.muted, letterSpacing: '0.1em', marginBottom: '3px' }}>{s.label}</div>
            <div style={{ fontFamily: C.mono, fontSize: '16px', fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontFamily: C.mono, fontSize: '8px', color: C.muted }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* SVG chart */}
      <div style={{ marginBottom: '8px' }}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ width: '100%', height: `${chartH}px`, display: 'block' }}
        >
          {/* Baseline */}
          <polyline points={baselinePoints} fill="none" stroke="#5a7da8" strokeWidth="0.5" opacity="0.6" vectorEffect="non-scaling-stroke" />
          {/* Seasonal */}
          <polyline points={seasonalPoints} fill="none" stroke="#22c55e" strokeWidth="0.8" opacity="0.7" vectorEffect="non-scaling-stroke" />
          {/* Full context */}
          <polyline points={contextPoints} fill="none" stroke="#6366f1" strokeWidth="1.2" opacity="0.9" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
        {[
          { color: '#5a7da8', label: 'μ_base (constant)' },
          { color: '#22c55e', label: '+ Seasonal × DoW' },
          { color: '#6366f1', label: '+ Events + Campaigns (full μ(t))' },
        ].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '20px', height: '2px', background: l.color, borderRadius: '1px' }} />
            <span style={{ fontFamily: C.mono, fontSize: '9px', color: C.muted }}>{l.label}</span>
          </div>
        ))}
      </div>

      {/* X-axis labels (every 5 days) */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {forecast.filter((_, i) => i % 5 === 0).map(f => (
          <span key={f.label} style={{ fontFamily: C.mono, fontSize: '8px', color: C.muted }}>{f.label}</span>
        ))}
      </div>

      <div style={{ marginTop: '16px', padding: '10px 12px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '5px' }}>
        <div style={{ fontFamily: C.mono, fontSize: '9px', color: '#a5b4fc', lineHeight: 1.7 }}>
          <strong>Context interpretation:</strong> APT28 and Turla historically peak in January–February.
          Patch Tuesday exploitation window (Feb 10 + 30d lag) active until March 12. Combined campaign
          prior C(t) = ×{((CAMPAIGN_GROUPS[0].monthlyIntensity[1] + CAMPAIGN_GROUPS[4].monthlyIntensity[1]) / 2).toFixed(2)} uplift
          on μ_base this month. No major event calendar pressure until Tax Deadline (T–{daysUntilActive(EVENTS[3])}d).
        </div>
      </div>
    </div>
  );
}

function BacktestTab() {
  const best = BACKTEST_MODELS[BACKTEST_MODELS.length - 1];

  return (
    <div>
      <div style={{ fontFamily: C.mono, fontSize: '10px', color: C.muted, marginBottom: '16px', lineHeight: 1.6 }}>
        Rolling-origin cross-validation · 90-day train / 30-day forecast / 7-day step · ~47 folds over 12-month holdout.
        DM test vs. baseline Hawkes.
      </div>

      {/* Model comparison cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
        {BACKTEST_MODELS.map((m, idx) => {
          const isBest = idx === BACKTEST_MODELS.length - 1;
          const mapeImprove = idx > 0 ? ((BACKTEST_MODELS[0].mape - m.mape) / BACKTEST_MODELS[0].mape * 100).toFixed(0) : null;

          return (
            <div
              key={m.model}
              style={{
                padding: '12px 14px',
                background: isBest ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${isBest ? 'rgba(99,102,241,0.4)' : C.border}`,
                borderLeft: `3px solid ${m.color}`,
                borderRadius: '6px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ fontFamily: C.mono, fontSize: '11px', fontWeight: isBest ? 700 : 400, color: isBest ? C.text : C.muted }}>
                  {m.model}
                </span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {isBest && (
                    <span style={{ padding: '2px 8px', borderRadius: '10px', background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', color: '#a5b4fc', fontFamily: C.mono, fontSize: '9px' }}>
                      ✦ BEST
                    </span>
                  )}
                  {m.dm_p !== null && (
                    <span style={{ fontFamily: C.mono, fontSize: '9px', color: m.dm_p < 0.01 ? '#22c55e' : '#eab308' }}>
                      DM p={m.dm_p}
                    </span>
                  )}
                  {mapeImprove && (
                    <span style={{ fontFamily: C.mono, fontSize: '9px', color: '#22c55e' }}>
                      −{mapeImprove}% MAPE
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px' }}>
                {[
                  { label: 'MAPE', value: (m.mape * 100).toFixed(0) + '%', target: '< 20%', good: m.mape < 0.20 },
                  { label: '90% COVERAGE', value: (m.coverage * 100).toFixed(0) + '%', target: '≥ 90%', good: m.coverage >= 0.90 },
                  { label: 'BRIER', value: m.brier.toFixed(2), target: '< 0.20', good: m.brier < 0.20 },
                  { label: 'AIC', value: m.aic.toLocaleString(), target: 'lower better', good: m.aic === Math.min(...BACKTEST_MODELS.map(x => x.aic)) },
                ].map(stat => (
                  <div key={stat.label}>
                    <div style={{ fontFamily: C.mono, fontSize: '8px', color: C.muted, letterSpacing: '0.1em', marginBottom: '3px' }}>{stat.label}</div>
                    <div style={{ fontFamily: C.mono, fontSize: '14px', fontWeight: 700, color: stat.good ? '#22c55e' : (idx === 0 ? '#ef4444' : C.muted) }}>
                      {stat.value}
                    </div>
                    {/* Progress bar */}
                    <div style={{ height: '3px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', marginTop: '3px', overflow: 'hidden' }}>
                      <div style={{
                        width: stat.label === 'MAPE' ? `${100 - m.mape * 200}%`
                               : stat.label === '90% COVERAGE' ? `${m.coverage * 100}%`
                               : stat.label === 'BRIER' ? `${100 - m.brier * 300}%`
                               : `${100 - (m.aic / 5000) * 100}%`,
                        height: '100%',
                        background: stat.good ? '#22c55e' : m.color,
                        borderRadius: '2px',
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                    <div style={{ fontFamily: C.mono, fontSize: '7px', color: C.muted, marginTop: '2px' }}>{stat.target}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary insight */}
      <div style={{ padding: '12px 14px', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '6px' }}>
        <div style={{ fontFamily: C.mono, fontSize: '9px', color: '#86efac', lineHeight: 1.7 }}>
          <strong>Result:</strong> Full covariate model achieves MAPE {(best.mape * 100).toFixed(0)}% vs baseline {(BACKTEST_MODELS[0].mape * 100).toFixed(0)}%
          — a {((BACKTEST_MODELS[0].mape - best.mape) / BACKTEST_MODELS[0].mape * 100).toFixed(0)}% reduction.
          Coverage {(best.coverage * 100).toFixed(0)}% meets the 90% calibration target.
          DM test p={best.dm_p} confirms the improvement is statistically significant (p&lt;0.05).
          AIC reduction of {(BACKTEST_MODELS[0].aic - best.aic).toLocaleString()} indicates covariates earn their complexity.
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PANEL ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'events',    label: '◈ EVENTS' },
  { id: 'seasonal',  label: '◊ SEASONAL' },
  { id: 'campaigns', label: '◉ CAMPAIGNS' },
  { id: 'forecast',  label: '▲ FORECAST' },
  { id: 'backtest',  label: '▣ BACKTEST' },
];

const API = import.meta.env.VITE_API_URL ?? '';

interface PredictiveContextPanelProps {
  onClose: () => void;
}

export function PredictiveContextPanel({ onClose }: PredictiveContextPanelProps) {
  const [activeTab, setActiveTab] = useState('events');

  // ── Live data state ──────────────────────────────────────────────────────
  const [liveEvents,   setLiveEvents]   = useState<LiveEvent[] | undefined>(undefined);
  const [liveSeasonal, setLiveSeasonal] = useState<LiveSeasonalData | undefined>(undefined);
  const [liveCampaigns,setLiveCampaigns]= useState<{ groups: LiveCampaignGroup[]; data_sources: string[] } | undefined>(undefined);
  const [liveForecast, setLiveForecast] = useState<LiveForecastData | undefined>(undefined);
  const [eventSources, setEventSources] = useState<string[]>([]);
  const [fetchError,   setFetchError]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      try {
        const [evRes, seaRes, camRes, fcRes] = await Promise.allSettled([
          fetch(`${API}/api/v1/context/events`),
          fetch(`${API}/api/v1/context/seasonal`),
          fetch(`${API}/api/v1/context/campaigns`),
          fetch(`${API}/api/v1/context/forecast?vector=ssh`),
        ]);

        if (cancelled) return;

        if (evRes.status === 'fulfilled' && evRes.value.ok) {
          const data = await evRes.value.json();
          setLiveEvents(data.events ?? []);
          setEventSources(data.data_sources ?? []);
        }
        if (seaRes.status === 'fulfilled' && seaRes.value.ok) {
          const data = await seaRes.value.json();
          setLiveSeasonal(data);
        }
        if (camRes.status === 'fulfilled' && camRes.value.ok) {
          const data = await camRes.value.json();
          setLiveCampaigns({ groups: data.groups ?? [], data_sources: data.data_sources ?? [] });
        }
        if (fcRes.status === 'fulfilled' && fcRes.value.ok) {
          const data = await fcRes.value.json();
          setLiveForecast(data);
        }
      } catch (e) {
        if (!cancelled) setFetchError('Backend unreachable — showing seed data');
      }
    }

    fetchAll();
    // Refresh every 5 min
    const interval = setInterval(fetchAll, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Count currently active events for badge (live data preferred)
  const activeEventCount = (liveEvents ?? EVENTS as LiveEvent[]).filter(isEventActive).length;

  function renderTab() {
    switch (activeTab) {
      case 'events':
        return <EventCalendarTab events={liveEvents} dataSources={eventSources.length ? eventSources : undefined} />;
      case 'seasonal':
        return <SeasonalHeatmapTab liveData={liveSeasonal} />;
      case 'campaigns':
        return <CampaignRecurrenceTab groups={liveCampaigns?.groups} dataSources={liveCampaigns?.data_sources} />;
      case 'forecast':
        return <ForecastTab liveData={liveForecast} />;
      case 'backtest':
        return <BacktestTab />;
      default:
        return <EventCalendarTab />;
    }
  }

  return (
    <div
      className="predictive-context-panel"
      style={{
        position: 'fixed',
        top: '60px',
        right: '16px',
        width: '840px',
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 80px)',
        zIndex: 1200,
        display: 'flex',
        flexDirection: 'column',
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: '10px',
        boxShadow: '0 8px 60px rgba(0,0,0,0.7)',
        backdropFilter: 'blur(24px)',
        overflow: 'hidden',
      }}
    >
      {/* ── Header ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 18px',
        borderBottom: `1px solid ${C.border}`,
        flexShrink: 0,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              fontFamily: C.mono, fontSize: '13px', fontWeight: 700,
              color: C.text, letterSpacing: '0.06em',
            }}>
              PREDICTIVE CONTEXT ENGINE
            </span>
            {activeEventCount > 0 && (
              <span style={{
                padding: '2px 8px', borderRadius: '10px',
                background: '#22c55e20', border: '1px solid #22c55e40',
                color: '#22c55e', fontFamily: C.mono, fontSize: '9px',
              }}>
                {activeEventCount} ACTIVE
              </span>
            )}
            {liveForecast?.is_live && (
              <span style={{
                padding: '2px 8px', borderRadius: '10px',
                background: 'rgba(0,204,255,0.08)', border: '1px solid rgba(0,204,255,0.25)',
                color: C.accent, fontFamily: C.mono, fontSize: '8px', letterSpacing: '0.08em',
              }}>
                ◉ CTI LIVE
              </span>
            )}
            {fetchError && (
              <span style={{
                padding: '2px 8px', borderRadius: '10px',
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                color: '#ef4444', fontFamily: C.mono, fontSize: '8px',
              }}>
                ⚠ {fetchError}
              </span>
            )}
          </div>
          <div style={{ fontFamily: C.mono, fontSize: '9px', color: C.muted, letterSpacing: '0.1em', marginTop: '3px' }}>
            INHOMOGENEOUS HAWKES · μ(t) = μ_base × S(t) × ∏(1+wᵢEᵢ(t)) × C(t)
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: C.muted,
            fontFamily: C.mono, fontSize: '18px', cursor: 'pointer',
            padding: '4px 8px', borderRadius: '4px',
          }}
        >
          ×
        </button>
      </div>

      {/* ── Tabs ── */}
      <div style={{
        display: 'flex',
        borderBottom: `1px solid ${C.border}`,
        flexShrink: 0,
        overflowX: 'auto',
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '10px 18px',
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${activeTab === t.id ? C.tabActive : 'transparent'}`,
              color: activeTab === t.id ? C.tabActive : C.muted,
              fontFamily: C.mono,
              fontSize: '10px',
              letterSpacing: '0.1em',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px', scrollbarWidth: 'thin' }}>
        {renderTab()}
      </div>
    </div>
  );
}
