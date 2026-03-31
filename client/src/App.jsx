import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const REFRESH_INTERVAL = 45_000;

function getScoreColor(score) {
  if (score >= 70) return 'var(--green)';
  if (score >= 50) return 'var(--amber)';
  return 'var(--red)';
}

function signalColor(color) {
  if (color === 'green') return 'var(--green)';
  if (color === 'red') return 'var(--red)';
  return 'var(--amber)';
}

function dirArrow(dir) {
  if (!dir) return '►';
  const d = dir.toLowerCase();
  if (['falling', 'bearish', 'deteriorating', 'contracting', 'tightening', 'defensive', 'weakening'].includes(d)) return '▼';
  if (['rising', 'bullish', 'improving', 'expanding', 'easing', 'broad', 'strong'].includes(d)) return '▲';
  return '►';
}

function formatTime(isoStr) {
  if (!isoStr) return '--';
  const diff = Math.round((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 10) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// Sparkline (tiny inline SVG chart)
function Sparkline({ data, width = 80, height = 20, color = 'var(--blue)' }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

// Score Ring
function ScoreRing({ score, size = 140, label }) {
  const r = (size - 16) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (score / 100) * circumference;
  const color = getScoreColor(score);

  return (
    <div className="score-ring-container">
      <div className="score-ring" style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          <circle className="ring-bg" cx={size/2} cy={size/2} r={r} />
          <circle className="ring-fg" cx={size/2} cy={size/2} r={r}
            stroke={color}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="score-text" style={{ color }}>{score}%</div>
      </div>
      {label && <div className="score-ring-label">{label}</div>}
    </div>
  );
}

// SPY Intraday Mini-Chart
function HeroIntraday({ data, spyPrice }) {
  if (!data || data.length < 2) return null;
  const open = data[0];
  const current = data[data.length - 1];
  const high = Math.max(...data);
  const low = Math.min(...data);
  const changeFromOpen = open ? ((current - open) / open * 100) : 0;
  const isUp = changeFromOpen >= 0;

  return (
    <div className="hero-intraday">
      <div className="label">SPY INTRADAY</div>
      <Sparkline data={data} width={180} height={40} color={isUp ? 'var(--green)' : 'var(--red)'} />
      <div className="intraday-stats">
        <span>O: {open.toFixed(2)}</span>
        <span>H: {high.toFixed(2)}</span>
        <span>L: {low.toFixed(2)}</span>
        <span style={{ color: isUp ? 'var(--green)' : 'var(--red)' }}>
          {isUp ? '+' : ''}{changeFromOpen.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}

// Score History Chart
function ScoreHistoryChart({ history }) {
  if (!history || history.length < 2) return null;
  const W = 800;
  const H = 60;
  const pad = 1;

  const scores = history.map(h => h.score);
  const min = Math.min(...scores, 0);
  const max = Math.max(...scores, 100);
  const range = max - min || 1;

  const getY = (v) => H - pad - ((v - min) / range) * (H - 2 * pad);
  const y60 = getY(60);
  const y80 = getY(80);

  // Build colored line segments
  const points = history.map((h, i) => ({
    x: (i / (history.length - 1)) * W,
    y: getY(h.score),
    score: h.score
  }));

  // Create a single polyline with gradient-like coloring via multiple segments
  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const avgScore = (p1.score + p2.score) / 2;
    const color = avgScore >= 80 ? 'var(--green)' : avgScore >= 60 ? 'var(--amber)' : 'var(--red)';
    segments.push(
      <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={color} strokeWidth="2" />
    );
  }

  const lastScore = scores[scores.length - 1];
  const lastP = points[points.length - 1];

  return (
    <div className="score-history">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span className="panel-title">SCORE HISTORY</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{history.length} data points</span>
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {/* Zone backgrounds */}
        <rect x="0" y="0" width={W} height={y80} fill="rgba(0,230,118,0.03)" />
        <rect x="0" y={y80} width={W} height={y60 - y80} fill="rgba(255,171,0,0.03)" />
        <rect x="0" y={y60} width={W} height={H - y60} fill="rgba(255,23,68,0.03)" />
        {/* Reference lines */}
        <line x1="0" y1={y80} x2={W} y2={y80} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="4,4" />
        <line x1="0" y1={y60} x2={W} y2={y60} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="4,4" />
        {/* Labels */}
        <text x="4" y={y80 - 2} fill="var(--text-muted)" fontSize="8">80</text>
        <text x="4" y={y60 - 2} fill="var(--text-muted)" fontSize="8">60</text>
        {/* Score line segments */}
        {segments}
        {/* Current score dot */}
        <circle cx={lastP.x} cy={lastP.y} r="3" fill={getScoreColor(lastScore)} />
      </svg>
    </div>
  );
}

// Ticker Bar
function TickerBar({ quotes, fetchedAt, onRefresh, loading, mode, onModeChange, tab, onTabChange, notifPermission, onRequestNotif, theme, onToggleTheme }) {
  const [timeStr, setTimeStr] = useState('--');

  useEffect(() => {
    const id = setInterval(() => setTimeStr(formatTime(fetchedAt)), 1000);
    setTimeStr(formatTime(fetchedAt));
    return () => clearInterval(id);
  }, [fetchedAt]);

  const tickers = quotes ? Object.entries(quotes).map(([sym, data]) => ({
    symbol: sym,
    price: data?.price?.toFixed(2) ?? '--',
    change: data?.change?.toFixed(2) ?? '0.00',
    up: (data?.change ?? 0) >= 0
  })) : [];

  return (
    <div className="ticker-bar">
      <div className="status">
        <span className={`dot ${loading ? 'loading' : ''}`} />
        <span>{loading ? 'UPDATING' : 'LIVE'}</span>
      </div>
      <div className="ticker-scroll">
        {tickers.map(t => (
          <div className="ticker-item" key={t.symbol}>
            <span className="symbol">{t.symbol}</span>
            <span className="price">{t.price}</span>
            <span className={`change ${t.up ? 'up' : 'down'}`}>
              {t.up ? '+' : ''}{t.change}%
            </span>
          </div>
        ))}
      </div>
      <div className="mode-toggle">
        <button className={`mode-btn ${tab === 'market' ? 'active' : ''}`} onClick={() => onTabChange('market')}>Market</button>
        <button className={`mode-btn ${tab === 'economic' ? 'active' : ''}`} onClick={() => onTabChange('economic')}>Economic</button>
        <button className={`mode-btn ${tab === 'lookup' ? 'active' : ''}`} onClick={() => onTabChange('lookup')}>Lookup</button>
      </div>
      <div className="mode-toggle" style={{ marginLeft: 4 }}>
        <button className={`mode-btn ${mode === 'swing' ? 'active' : ''}`} onClick={() => onModeChange('swing')}>Swing</button>
        <button className={`mode-btn ${mode === 'day' ? 'active' : ''}`} onClick={() => onModeChange('day')}>Day</button>
      </div>
      <button className="theme-toggle" onClick={onToggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      {notifPermission !== 'granted' && (
        <button className="mode-btn" onClick={onRequestNotif} style={{ fontSize: 9, padding: '3px 8px', flexShrink: 0 }}>ALERTS</button>
      )}
      <div className="timestamp">updated {timeStr}</div>
      <button className="refresh-btn" onClick={onRefresh} disabled={loading}>
        {loading ? '...' : '↻ REFRESH'}
      </button>
    </div>
  );
}

// Alert Banner
function AlertBanner({ fomc }) {
  if (!fomc?.imminent) return null;
  return (
    <div className="alert-banner">
      <span>⚠</span>
      <span>
        FOMC MEETING {fomc.isToday ? 'TODAY' : `IN ${fomc.hoursUntil}H`} ({fomc.date}) — Expect elevated volatility. Consider reducing position sizes.
      </span>
    </div>
  );
}

// Category Panel
function CategoryPanel({ title, data }) {
  if (!data) return <div className="panel skeleton skeleton-panel" />;

  const color = getScoreColor(data.score);
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">{title}</span>
        <span className={`panel-badge ${data.interpretation}`}>{data.interpretation}</span>
      </div>
      <div className="panel-score" style={{ color }}>{data.score}</div>
      <div className="panel-direction">
        <span>{dirArrow(data.direction)}</span>
        <span>{data.direction}</span>
      </div>
      <div className="panel-bar">
        <div className="panel-bar-fill" style={{ width: `${data.score}%`, background: color }} />
      </div>
    </div>
  );
}

// Sector Heatmap with timeframe toggle
const TIMEFRAMES = ['1D', '1W', '1M', '3M'];

function SectorHeatmap({ sectors }) {
  const [tf, setTf] = useState('1D');
  if (!sectors?.length) return null;

  const sorted = [...sectors].map(s => {
    const change = tf === '1D' ? s.change : (s.timeframes?.[tf] ?? s.change);
    return { ...s, displayChange: change };
  }).sort((a, b) => b.displayChange - a.displayChange);

  const maxAbs = Math.max(...sorted.map(s => Math.abs(s.displayChange)), 0.01);

  return (
    <div className="sector-heatmap">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span className="panel-title">SECTOR PERFORMANCE</span>
        <div className="mode-toggle">
          {TIMEFRAMES.map(t => (
            <button key={t} className={`mode-btn ${tf === t ? 'active' : ''}`} onClick={() => setTf(t)}>{t}</button>
          ))}
        </div>
      </div>
      <div className="sector-bars">
        {sorted.map(s => {
          const pct = Math.abs(s.displayChange) / maxAbs * 50;
          const isPositive = s.displayChange >= 0;
          return (
            <div className="sector-row" key={s.symbol}>
              <span className="sym">{s.symbol}</span>
              <span className="name">{s.name}</span>
              <div className="sector-bar-track">
                <div className="sector-bar-center" />
                <div
                  className={`sector-bar-fill ${isPositive ? 'positive' : 'negative'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className={`pct ${isPositive ? 'up' : 'down'}`}>
                {isPositive ? '+' : ''}{s.displayChange.toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Scoring Breakdown
function ScoringBreakdown({ categories, weights }) {
  if (!categories || !weights) return null;

  const items = [
    { key: 'volatility', label: 'Volatility' },
    { key: 'momentum', label: 'Momentum' },
    { key: 'trend', label: 'Trend' },
    { key: 'breadth', label: 'Breadth' },
    { key: 'macro', label: 'Macro' },
  ];

  return (
    <div className="scoring-breakdown">
      <div className="panel-title" style={{ marginBottom: 12 }}>SCORING BREAKDOWN</div>
      <div className="breakdown-rows">
        {items.map(({ key, label }) => {
          const cat = categories[key];
          if (!cat) return null;
          const w = Math.round((weights[key] || 0) * 100);
          const color = getScoreColor(cat.score);
          const contribution = Math.round(cat.score * (weights[key] || 0));
          return (
            <div className="breakdown-row" key={key}>
              <span className="cat">{label}</span>
              <span className="weight">{w}%</span>
              <div className="breakdown-bar-track">
                <div className="breakdown-bar-fill" style={{ width: `${cat.score}%`, background: color }} />
              </div>
              <span className="score-val" style={{ color }}>{cat.score}</span>
              <span style={{ width: 35, textAlign: 'right', color: 'var(--text-muted)', fontSize: 10, flexShrink: 0 }}>+{contribution}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Execution Window
function ExecutionWindow({ exec }) {
  if (!exec) return null;
  const color = getScoreColor(exec.score);
  const checks = [
    { label: 'Breakouts holding', ok: exec.breakoutsHolding },
    { label: 'Pullbacks bought', ok: exec.pullbacksBought },
    { label: 'Multi-day follow-through', ok: exec.multiDayFollowThrough },
  ];

  return (
    <div className="exec-window">
      <div className="exec-label">Execution Window</div>
      <div className="exec-score" style={{ color }}>{exec.score}%</div>
      <div className="exec-checks">
        {checks.map(c => (
          <div className="exec-check" key={c.label}>
            <span className={c.ok ? 'c-green' : 'c-red'}>{c.ok ? '✓' : '✗'}</span>
            <span>{c.label}</span>
          </div>
        ))}
        <div className="exec-check" style={{ marginTop: 4 }}>
          <span style={{ color: 'var(--text-muted)' }}>Follow-through: {exec.followThroughRate}%</span>
        </div>
      </div>
    </div>
  );
}

// ── Screener / Biggest Movers ──

function formatVol(v) {
  if (!v) return '--';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toString();
}

function formatCap(v) {
  if (!v) return '--';
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  return v.toString();
}

const SCREENER_TABS = [
  { key: 'most_actives', label: 'Most Active' },
  { key: 'trending', label: 'Trending Now' },
  { key: 'day_gainers', label: 'Top Gainers' },
  { key: 'day_losers', label: 'Top Losers' },
  { key: 'w52_gainers', label: '52 Week Gainers' },
  { key: 'w52_losers', label: '52 Week Losers' },
];

const SCREENER_COLUMNS = [
  { key: 'symbol', label: 'Symbol', cls: 'sc-sym', sortable: true },
  { key: 'name', label: 'Name', cls: 'sc-name', sortable: true },
  { key: 'price', label: 'Price', cls: 'sc-price', sortable: true, numeric: true },
  { key: 'changeDollar', label: 'Change', cls: 'sc-chgd', sortable: true, numeric: true },
  { key: 'change', label: '% Change', cls: 'sc-chgp', sortable: true, numeric: true },
  { key: 'volume', label: 'Volume', cls: 'sc-vol', sortable: true, numeric: true },
  { key: 'avgVolume3mo', label: 'Avg Vol (3M)', cls: 'sc-avgvol', sortable: true, numeric: true },
  { key: 'marketCap', label: 'Market Cap', cls: 'sc-cap', sortable: true, numeric: true },
  { key: 'pe', label: 'P/E Ratio (TTM)', cls: 'sc-pe', sortable: true, numeric: true },
  { key: 'w52Change', label: '52 Wk Change %', cls: 'sc-w52chg', sortable: true, numeric: true },
  { key: 'w52Range', label: '52W Range', cls: 'sc-range', sortable: false },
];

function ScreenerTable({ data }) {
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('desc');

  if (!data?.length) return (
    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>Loading...</div>
  );

  const handleSort = (col) => {
    if (!col.sortable) return;
    if (sortCol === col.key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col.key);
      setSortDir(col.numeric ? 'desc' : 'asc');
    }
  };

  let sorted = data;
  if (sortCol) {
    sorted = [...data].sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') {
        const cmp = va.localeCompare(vb, undefined, { sensitivity: 'base' });
        return sortDir === 'asc' ? cmp : -cmp;
      }
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }

  return (
    <div className="screener-table-wrap">
      <table className="screener-table">
        <thead>
          <tr>
            {SCREENER_COLUMNS.map(col => (
              <th
                key={col.key}
                className={`${col.cls}${col.sortable ? ' sortable' : ''}${sortCol === col.key ? ' sorted' : ''}`}
                onClick={() => handleSort(col)}
              >
                {col.label}
                {sortCol === col.key && <span className="sort-arrow">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(t => {
            const isUp = (t.change ?? 0) >= 0;
            const isDollarUp = (t.changeDollar ?? 0) >= 0;
            return (
              <tr key={t.symbol}>
                <td className="sc-sym">{t.symbol}</td>
                <td className="sc-name">{t.name}</td>
                <td className="sc-price">{t.price?.toFixed(2) ?? '--'}</td>
                <td className={`sc-chgd ${isDollarUp ? 'up' : 'down'}`}>
                  {isDollarUp ? '+' : ''}{t.changeDollar?.toFixed(2) ?? '--'}
                </td>
                <td className={`sc-chgp ${isUp ? 'up' : 'down'}`}>
                  {isUp ? '+' : ''}{t.change?.toFixed(2) ?? '0.00'}%
                </td>
                <td className="sc-vol">{formatVol(t.volume)}</td>
                <td className="sc-avgvol">{formatVol(t.avgVolume3mo)}</td>
                <td className="sc-cap">{formatCap(t.marketCap)}</td>
                <td className="sc-pe">{t.pe != null ? t.pe.toFixed(2) : '--'}</td>
                <td className={`sc-w52chg ${(t.w52Change ?? 0) >= 0 ? 'up' : 'down'}`}>
                  {t.w52Change != null ? `${t.w52Change >= 0 ? '+' : ''}${t.w52Change.toFixed(2)}%` : '--'}
                </td>
                <td className="sc-range">
                  <div className="sc-range-wrap">
                    <span className="sc-range-lo">{t.w52Low?.toFixed(2) ?? '--'}</span>
                    <div className="sc-range-bar">
                      <div className="sc-range-track">
                        <div className="sc-range-dot" style={{ left: `${Math.max(0, Math.min(100, t.w52Pct || 50))}%` }} />
                      </div>
                    </div>
                    <span className="sc-range-hi">{t.w52High?.toFixed(2) ?? '--'}</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HottestNames() {
  const [activeTab, setActiveTab] = useState('most_actives');
  const [screenerData, setScreenerData] = useState({});
  const [screenerLoading, setScreenerLoading] = useState({});

  const fetchTab = useCallback(async (screen) => {
    if (screenerLoading[screen]) return;
    setScreenerLoading(prev => ({ ...prev, [screen]: true }));
    try {
      const res = await fetch(`${API_BASE}/screener?screen=${screen}`);
      if (res.ok) {
        const data = await res.json();
        setScreenerData(prev => ({ ...prev, [screen]: data }));
      }
    } catch {} finally {
      setScreenerLoading(prev => ({ ...prev, [screen]: false }));
    }
  }, []);

  // Fetch active tab on mount and tab change
  useEffect(() => {
    if (!screenerData[activeTab]) {
      fetchTab(activeTab);
    }
  }, [activeTab, fetchTab]);

  // Auto-refresh current tab every 60s
  useEffect(() => {
    const id = setInterval(() => fetchTab(activeTab), 60_000);
    return () => clearInterval(id);
  }, [activeTab, fetchTab]);

  const currentData = screenerData[activeTab];

  return (
    <div className="screener-section">
      <div className="screener-header">
        <div className="screener-tabs">
          {SCREENER_TABS.map(t => (
            <button
              key={t.key}
              className={`screener-tab ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="screener-count">
          {screenerLoading[activeTab] ? 'Loading...' : `${currentData?.length || 0} results`}
        </span>
      </div>
      <ScreenerTable data={currentData} />
    </div>
  );
}

// ── Watchlist ──

function WatchlistPanel({ watchlist, setWatchlist, watchlistData, fetchWatchlist }) {
  const [input, setInput] = useState('');

  const addTicker = () => {
    const sym = input.trim().toUpperCase();
    if (!sym || watchlist.includes(sym) || watchlist.length >= 20) return;
    const next = [...watchlist, sym];
    setWatchlist(next);
    setInput('');
  };

  const removeTicker = (sym) => {
    setWatchlist(watchlist.filter(s => s !== sym));
  };

  function rsiColor(rsi) {
    if (rsi == null) return 'var(--text-muted)';
    if (rsi >= 70 || rsi <= 30) return 'var(--red)';
    if (rsi >= 60 || rsi <= 40) return 'var(--amber)';
    return 'var(--green)';
  }

  return (
    <div className="watchlist-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span className="panel-title">WATCHLIST</span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{watchlist.length}/20</span>
      </div>
      <div className="watchlist-input-row">
        <input
          className="watchlist-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTicker()}
          placeholder="Add ticker..."
          maxLength={10}
        />
        <button className="watchlist-add-btn" onClick={addTicker}>ADD</button>
      </div>
      {watchlistData && watchlistData.length > 0 && (
        <div className="watchlist-rows">
          {watchlistData.map(item => {
            const isUp = item.change >= 0;
            return (
              <div className="watchlist-row" key={item.symbol}>
                <span className="wl-sym">{item.symbol}</span>
                <span className="wl-price">{item.price.toFixed(2)}</span>
                <span className={`wl-change ${isUp ? 'up' : 'down'}`}>
                  {isUp ? '+' : ''}{item.change.toFixed(2)}%
                </span>
                <span className="wl-rsi" style={{ color: rsiColor(item.rsi) }}>
                  {item.rsi != null ? `RSI ${item.rsi}` : '--'}
                </span>
                <span className={item.aboveSMA50 ? 'c-green' : 'c-red'}>
                  {item.aboveSMA50 == null ? '--' : item.aboveSMA50 ? '> 50SMA' : '< 50SMA'}
                </span>
                <button className="wl-remove" onClick={() => removeTicker(item.symbol)}>✗</button>
              </div>
            );
          })}
        </div>
      )}
      {watchlist.length > 0 && (!watchlistData || watchlistData.length === 0) && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: 8 }}>Loading watchlist data...</div>
      )}
    </div>
  );
}

// ── Alert Toast ──

function AlertToast({ alerts, onDismiss }) {
  if (!alerts.length) return null;

  return (
    <div className="alert-toast-container">
      {alerts.slice(0, 3).map((a, i) => (
        <div key={a.ts + '-' + i} className={`alert-toast alert-${a.type}`}>
          <span>{a.type === 'positive' ? '▲' : a.type === 'danger' ? '▼' : '►'}</span>
          <span className="alert-msg">{a.msg}</span>
          <span className="alert-time">{formatTime(new Date(a.ts).toISOString())}</span>
          <button className="alert-dismiss" onClick={() => onDismiss(i)}>✗</button>
        </div>
      ))}
    </div>
  );
}

// ── FRED / Economic Data Tab ──

function FredDataRow({ item }) {
  if (!item || item.value == null) return null;
  const c = item.classification;
  const color = c ? signalColor(c.color) : 'var(--text-secondary)';
  const dir = item.direction;
  const arrow = dir === 'rising' ? '▲' : dir === 'falling' ? '▼' : '►';
  const changeStr = item.change
    ? `${item.change.absolute >= 0 ? '+' : ''}${item.change.absolute.toFixed(2)}`
    : '';

  let displayVal = item.value;
  if ((item.id === 'CPIAUCSL' || item.id === 'CPILFESL') && item.yoyChange != null) {
    displayVal = `${item.yoyChange.toFixed(1)}% YoY`;
  } else if (item.unit === 'K') displayVal = `${(item.value).toFixed(0)}K`;
  else if (item.unit === '%') displayVal = `${item.value.toFixed(2)}%`;
  else displayVal = item.value.toFixed(2);

  return (
    <div className="fred-row">
      <span className="fred-name">{item.name}</span>
      <Sparkline data={item.history} color={color} />
      <span className="fred-value" style={{ color }}>{displayVal}</span>
      <span className="fred-change" style={{ color: item.change?.absolute >= 0 ? 'var(--text-secondary)' : 'var(--text-secondary)' }}>
        {arrow} {changeStr}
      </span>
      {c?.label && <span className="fred-signal" style={{ color, background: `${color}15` }}>{c.label}</span>}
      <span className="fred-date">{item.date}</span>
    </div>
  );
}

function FredSection({ title, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="fred-section">
      <div className="panel-title" style={{ marginBottom: 8 }}>{title}</div>
      {items.map(item => <FredDataRow key={item.id} item={item} />)}
    </div>
  );
}

function EconomicTab({ fred }) {
  if (!fred) {
    return (
      <div className="dashboard">
        <div className="skeleton" style={{ height: 400 }} />
      </div>
    );
  }

  const { series, derived } = fred;
  const byCategory = {};
  for (const item of Object.values(series)) {
    if (!item.value) continue;
    const cat = item.category || 'other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(item);
  }

  const yc = derived?.yieldCurve;
  const cc = derived?.creditConditions;

  return (
    <div className="dashboard">
      {yc?.inverted && (
        <div className="alert-banner" style={{ marginBottom: 16 }}>
          <span>⚠</span>
          <span>
            YIELD CURVE INVERTED — 10Y-2Y spread: {yc.spread10y2y?.toFixed(2)}% | 10Y-3M spread: {yc.spread10y3m?.toFixed(2)}%
            {yc.recessionSignal ? ' — Recession probability elevated' : ''}
          </span>
        </div>
      )}

      {cc?.stressed && (
        <div className="alert-banner" style={{ marginBottom: 16, background: 'rgba(255,23,68,0.1)', borderColor: 'var(--red-dim)' }}>
          <span>⚠</span>
          <span>
            CREDIT STRESS — High yield spread at {cc.hySpread?.toFixed(2)}% ({cc.direction})
          </span>
        </div>
      )}

      <div className="fred-summary-grid">
        <div className="panel">
          <div className="panel-title">YIELD CURVE</div>
          <div className="fred-derived-val" style={{ color: yc?.inverted ? 'var(--red)' : 'var(--green)' }}>
            {yc?.spread10y2y != null ? `${yc.spread10y2y.toFixed(2)}%` : '--'}
          </div>
          <div className="fred-derived-label">10Y-2Y Spread</div>
          <div className="fred-derived-sub" style={{ color: yc?.inverted ? 'var(--red)' : 'var(--text-muted)' }}>
            {yc?.inverted ? 'INVERTED' : 'NORMAL'}
          </div>
        </div>
        <div className="panel">
          <div className="panel-title">CREDIT</div>
          <div className="fred-derived-val" style={{ color: cc?.stressed ? 'var(--red)' : 'var(--green)' }}>
            {cc?.hySpread != null ? `${cc.hySpread.toFixed(2)}%` : '--'}
          </div>
          <div className="fred-derived-label">HY Spread</div>
          <div className="fred-derived-sub">{cc?.direction || '--'}</div>
        </div>
        <div className="panel">
          <div className="panel-title">FED POLICY</div>
          <div className="fred-derived-val" style={{ color: derived?.fedPolicy?.stance === 'restrictive' || derived?.fedPolicy?.stance === 'very_restrictive' ? 'var(--red)' : derived?.fedPolicy?.stance === 'accommodative' ? 'var(--green)' : 'var(--amber)' }}>
            {derived?.fedPolicy?.rate != null ? `${derived.fedPolicy.rate.toFixed(2)}%` : '--'}
          </div>
          <div className="fred-derived-label">Fed Funds Rate</div>
          <div className="fred-derived-sub">{derived?.fedPolicy?.stance?.replace('_', ' ').toUpperCase() || '--'}</div>
        </div>
        <div className="panel">
          <div className="panel-title">INFLATION</div>
          <div className="fred-derived-val" style={{ color: (series?.CPIAUCSL?.yoyChange ?? 0) > 3 ? 'var(--red)' : 'var(--green)' }}>
            {series?.CPIAUCSL?.yoyChange != null ? `${series.CPIAUCSL.yoyChange.toFixed(1)}%` : '--'}
          </div>
          <div className="fred-derived-label">CPI YoY</div>
          <div className="fred-derived-sub">{series?.CPIAUCSL?.direction || '--'}</div>
        </div>
      </div>

      <div className="fred-tables">
        <FredSection title="INTEREST RATES" items={byCategory.rates} />
        <FredSection title="VOLATILITY" items={byCategory.volatility} />
        <FredSection title="CREDIT" items={byCategory.credit} />
        <FredSection title="LABOR MARKET" items={byCategory.labor} />
        <FredSection title="INFLATION" items={byCategory.inflation} />
        <FredSection title="CURRENCY" items={byCategory.currency} />
      </div>

      {/* AI Macro Report */}
      <MacroReport />

      {/* Rule-based economic signals */}
      <EconomicOutlook fred={fred} />

      <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '8px 0', textAlign: 'right' }}>
        Source: FRED (Federal Reserve Economic Data) | Updated: {formatTime(fred.fetchedAt)}
      </div>
    </div>
  );
}

// ── Stock Lookup Tab ──

const CHART_RANGES = [
  { label: '1D', range: '1d', interval: '5m' },
  { label: '1W', range: '5d', interval: '15m' },
  { label: '1M', range: '1mo', interval: '1d' },
  { label: '3M', range: '3mo', interval: '1d' },
  { label: '1Y', range: '1y', interval: '1d' },
];

function fmt(v, decimals = 2) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toFixed(decimals);
}
function fmtPct(v) { if (v == null) return '—'; return `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`; }
function fmtCap(v) {
  if (v == null) return '—';
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  return v.toLocaleString();
}
function fmtVol(v) {
  if (v == null) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toString();
}

function LookupChart({ symbol }) {
  const [activeRange, setActiveRange] = useState(CHART_RANGES[0]);
  const [bars, setBars] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    setChartLoading(true);
    fetch(`${API_BASE}/chart?symbol=${symbol}&range=${activeRange.range}&interval=${activeRange.interval}`)
      .then(r => r.json())
      .then(d => { setBars(d.bars || []); setChartLoading(false); })
      .catch(() => setChartLoading(false));
  }, [symbol, activeRange]);

  const closes = bars.map(b => b.c).filter(Boolean);
  if (!closes.length && !chartLoading) return null;

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const W = 700, H = 100;
  const pts = closes.map((c, i) => {
    const x = (i / Math.max(closes.length - 1, 1)) * W;
    const y = H - ((c - min) / range) * H;
    return `${x},${y}`;
  });
  const isUp = closes.length >= 2 && closes[closes.length - 1] >= closes[0];
  const color = isUp ? 'var(--green)' : 'var(--red)';
  const polyline = pts.join(' ');
  const areaPath = closes.length >= 2
    ? `M0,${H} L${pts.join(' L')} L${W},${H} Z`
    : '';

  return (
    <div className="lookup-chart">
      <div className="chart-tabs">
        {CHART_RANGES.map(r => (
          <button
            key={r.label}
            className={`chart-tab-btn ${activeRange.label === r.label ? 'active' : ''}`}
            onClick={() => setActiveRange(r)}
          >{r.label}</button>
        ))}
      </div>
      <div style={{ position: 'relative', height: H + 4 }}>
        {chartLoading ? (
          <div className="skeleton" style={{ height: H, borderRadius: 4 }} />
        ) : (
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
            <defs>
              <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.25" />
                <stop offset="100%" stopColor={color} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {areaPath && <path d={areaPath} fill="url(#chartGrad)" />}
            <polyline points={polyline} fill="none" stroke={color} strokeWidth="1.5" />
          </svg>
        )}
      </div>
      <div className="chart-range-labels">
        <span>{closes.length ? `Low: ${fmt(min)}` : ''}</span>
        <span>{closes.length ? `High: ${fmt(max)}` : ''}</span>
      </div>
    </div>
  );
}

// ── News & Analysis Components ──

function NewsItem({ item }) {
  return (
    <div className="news-item">
      <a href={item.url} target="_blank" rel="noopener noreferrer" className="news-headline">
        {item.headline}
      </a>
      <div className="news-meta">
        {item.source && <span className="news-source">{item.source}</span>}
        {item.time && <span className="news-time">{item.time}</span>}
      </div>
    </div>
  );
}

const VERDICT_COLORS = { Bullish: 'var(--green)', Neutral: 'var(--amber)', Bearish: 'var(--red)' };

function StockAnalysis({ symbol }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    setAnalysis(null);
    fetch(`${API_BASE}/analysis?symbol=${symbol}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setAnalysis(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) return <div className="analysis-loading">Generating AI analysis...</div>;
  if (!analysis) return null;

  const verdictColor = VERDICT_COLORS[analysis.verdict] || 'var(--amber)';

  return (
    <div className="analysis-section">
      <div className="analysis-header-row">
        <div className="detail-section-title" style={{ marginBottom: 0 }}>AI Analysis</div>
        {analysis.verdict && (
          <span className="verdict-badge" style={{ color: verdictColor, borderColor: verdictColor }}>
            {analysis.verdict.toUpperCase()}
          </span>
        )}
      </div>

      <div className="analysis-grid" style={{ marginTop: 10 }}>
        <div className="analysis-panel bull">
          <div className="analysis-panel-title">Bull Case</div>
          <p className="analysis-text">{analysis.bullCase}</p>
          <div className="catalyst-list">
            {analysis.bullCatalysts?.map((c, i) => (
              <div key={i} className="catalyst-item bull"><span className="catalyst-num">{i + 1}</span>{c}</div>
            ))}
          </div>
        </div>
        <div className="analysis-panel bear">
          <div className="analysis-panel-title">Bear Case</div>
          <p className="analysis-text">{analysis.bearCase}</p>
          <div className="catalyst-list">
            {analysis.bearCatalysts?.map((c, i) => (
              <div key={i} className="catalyst-item bear"><span className="catalyst-num">{i + 1}</span>{c}</div>
            ))}
          </div>
        </div>
      </div>

      {analysis.keyMetrics && (
        <div className="key-metrics-box">
          <span className="key-metrics-label">Key Metrics to Watch</span>
          <p className="key-metrics-text">{analysis.keyMetrics}</p>
        </div>
      )}

      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
        AI-generated · Not financial advice · Cached 4h
      </div>
    </div>
  );
}

function MarketOutlook({ scored }) {
  if (!scored?.categories) return null;

  const bullPoints = [];
  const bearPoints = [];

  const catLabels = { volatility: 'Volatility', trend: 'Trend', breadth: 'Breadth', momentum: 'Momentum', macro: 'Macro' };
  Object.entries(scored.categories).forEach(([key, cat]) => {
    if (!cat) return;
    const label = `${catLabels[key] || key}: ${cat.interpretation}`;
    if (cat.score >= 65) bullPoints.push(label);
    else if (cat.score <= 40) bearPoints.push(label);
  });

  const ew = scored.executionWindow;
  if (ew) {
    if (ew.breakoutsHolding) bullPoints.push('Breakouts holding above key levels');
    else bearPoints.push('Breakouts failing — sell pressure elevated');
    if (ew.pullbacksBought) bullPoints.push('Pullbacks being bought — dip buyers active');
    else bearPoints.push('Pullbacks not supported — buyers absent');
  }

  return (
    <div className="analysis-section">
      <div className="detail-section-title">Market Outlook</div>
      <div className="analysis-grid">
        <div className="analysis-panel bull">
          <div className="analysis-panel-title">Bullish Signals</div>
          {bullPoints.length
            ? bullPoints.map((p, i) => <div key={i} className="catalyst-item bull">+ {p}</div>)
            : <div className="catalyst-item muted">No strong bullish signals currently</div>}
        </div>
        <div className="analysis-panel bear">
          <div className="analysis-panel-title">Bearish Signals</div>
          {bearPoints.length
            ? bearPoints.map((p, i) => <div key={i} className="catalyst-item bear">− {p}</div>)
            : <div className="catalyst-item muted">No strong bearish signals currently</div>}
        </div>
      </div>
    </div>
  );
}

function MarketNews() {
  const [news, setNews] = useState([]);

  useEffect(() => {
    fetch(`${API_BASE}/market-news`)
      .then(r => r.json())
      .then(d => Array.isArray(d) && setNews(d))
      .catch(() => {});
  }, []);

  if (!news.length) return null;

  return (
    <div className="panel news-panel">
      <div className="panel-title">Market News</div>
      {news.map((item, i) => <NewsItem key={i} item={item} />)}
    </div>
  );
}

function EconomicOutlook({ fred }) {

  if (!fred?.series || !fred?.derived) return null;

  const { yieldCurve, creditConditions, fedPolicy } = fred.derived;
  const { series } = fred;

  const fedRate = fedPolicy?.rate?.toFixed(2);
  const fedStance = fedPolicy?.stance?.replace(/_/g, ' ') || 'unknown';
  const ycSpread = yieldCurve?.spread10y2y?.toFixed(2);
  const ycInverted = yieldCurve?.inverted;
  const hySpread = creditConditions?.hySpread?.toFixed(2);
  const creditStressed = creditConditions?.stressed;
  const cpiYoY = series?.CPIAUCSL?.yoyChange?.toFixed(1);
  const cpiDir = series?.CPIAUCSL?.direction || 'changing';
  const unemployment = series?.UNRATE?.value;
  const initialClaims = series?.IC4WSA?.value || series?.ICSA?.value;
  const mortgage30 = series?.MORTGAGE30US?.value;

  const sections = [];

  // ── Interest Rates & Fed ──
  if (fedRate || ycSpread) {
    let text = '';
    if (fedRate) {
      text += `The Federal Reserve is currently holding its benchmark rate at ${fedRate}%, a ${fedStance} monetary policy stance. `;
      if (['restrictive', 'very restrictive'].includes(fedStance)) {
        text += `Rates at this level make borrowing more expensive for businesses and consumers — mortgages, auto loans, and corporate debt all carry higher costs, which tends to slow spending and investment over time. `;
      } else if (fedStance === 'accommodative') {
        text += `At this level, the Fed is actively supporting the economy — cheap borrowing encourages businesses to invest and consumers to spend. `;
      } else {
        text += `This neutral stance means the Fed is neither pressing the gas nor the brake on economic activity. `;
      }
    }
    if (mortgage30) text += `The 30-year mortgage rate sits at ${mortgage30}%, making home affordability a real challenge for buyers. `;
    if (ycSpread) {
      text += `The yield curve — the spread between 10-year and 2-year Treasury yields — stands at ${ycSpread}%. `;
      text += ycInverted
        ? `An inverted yield curve has preceded every US recession in modern history. While the timing is unpredictable and the signal can persist for 12–24 months before any slowdown materializes, it is a warning sign that markets are pricing in future economic weakness.`
        : `A positive spread is the normal, healthy configuration — long-term bonds yield more than short-term ones, reflecting market confidence in future growth rather than fear of a downturn.`;
    }
    sections.push({ title: 'Interest Rates & Federal Reserve', text });
  }

  // ── Inflation ──
  if (cpiYoY) {
    const cpiNum = parseFloat(cpiYoY);
    let text = `Consumer prices are ${cpiDir} at ${cpiYoY}% year-over-year. `;
    if (cpiNum > 5) {
      text += `This is well above the Fed's 2% target and represents a significant burden on everyday Americans — groceries, rent, and energy are all meaningfully more expensive than they were a year ago. At this level, the Fed has little room to cut rates, and any hint of re-acceleration in inflation could force further hikes. For investors, high inflation erodes the real value of cash and bonds, and can compress profit margins as companies pay more for inputs.`;
    } else if (cpiNum > 3) {
      text += `While inflation has cooled from its recent peak, it remains above the Fed's 2% target. This keeps the central bank in a watchful, cautious mode — unlikely to raise rates further but not yet confident enough to cut. For investors, this is the "last mile" problem: bringing inflation from 3% to 2% has historically been harder than the initial decline. Markets will continue to react strongly to each monthly CPI print.`;
    } else if (cpiNum > 2) {
      text += `Inflation is within striking distance of the Fed's 2% target. This is a constructive development — it opens the door for potential rate cuts if the labor market softens, which would be a significant tailwind for stocks and bonds alike. The disinflationary trend, if sustained, removes one of the biggest overhangs that has weighed on markets.`;
    } else {
      text += `Inflation is at or below the Fed's 2% target, giving the central bank significant room to cut rates if economic growth falters. This is a supportive backdrop for risk assets, as lower rates reduce the discount rate applied to future earnings and make bonds less competitive relative to stocks.`;
    }
    sections.push({ title: 'Inflation', text });
  }

  // ── Labor Market ──
  if (unemployment || initialClaims) {
    let text = '';
    if (unemployment) {
      const u = parseFloat(unemployment);
      text += `The unemployment rate is ${unemployment}%. `;
      if (u < 4) text += `This is historically low — essentially full employment. A tight labor market means workers have bargaining power, wages are rising, and consumer spending remains supported. The flip side is that wage growth can feed back into inflation, complicating the Fed's job. `;
      else if (u < 5) text += `This represents a balanced labor market — neither overheating nor alarming. Most people who want to work can find a job, which keeps consumer confidence and spending relatively healthy. `;
      else text += `This level signals softening in the jobs market. Rising unemployment tends to weigh on consumer confidence and spending, which can create a self-reinforcing slowdown if businesses respond by cutting further. `;
    }
    if (initialClaims) {
      const claims = Math.round(initialClaims / 1000);
      text += `Weekly jobless claims — the number of Americans filing for unemployment for the first time — are running at ${claims}K. `;
      text += initialClaims < 220000
        ? `This is a low number, indicating that layoffs remain contained and the labor market is still healthy.`
        : initialClaims < 300000
        ? `This is a moderate level — not alarming, but worth watching for signs of deterioration.`
        : `This elevated level suggests companies are beginning to cut headcount at a meaningful pace, which could signal broader economic stress ahead.`;
    }
    sections.push({ title: 'Labor Market', text });
  }

  // ── Credit & Liquidity ──
  if (hySpread) {
    let text = `High-yield credit spreads measure the extra yield investors demand to lend money to riskier companies versus the US government. Currently at ${hySpread}%, spreads are ${creditConditions?.direction || 'stable'}. `;
    if (creditStressed) {
      text += `This elevated level signals genuine financial stress — investors are demanding significantly more compensation for risk, which means borrowing costs for weaker companies are rising sharply. Historically, wide spreads precede an increase in corporate defaults and a tightening of overall credit conditions, which can slow economic activity and weigh on equities. This is a yellow to red flag for the broader market.`;
    } else {
      text += `This contained level suggests that credit markets are functioning smoothly and there is no systemic stress in the financial system. When spreads are tight, it reflects investor confidence that companies can service their debts — a healthy signal for economic stability and equity markets. It also means that companies can borrow at reasonable rates to invest and grow.`;
    }
    sections.push({ title: 'Credit Markets & Financial Conditions', text });
  }

  // ── Overall assessment ──
  const bullScore = [!ycInverted, !creditStressed, unemployment && parseFloat(unemployment) < 4.5, cpiYoY && parseFloat(cpiYoY) < 3.5].filter(Boolean).length;
  const bearScore = [ycInverted, creditStressed, cpiYoY && parseFloat(cpiYoY) > 4, ['restrictive', 'very restrictive'].includes(fedStance)].filter(Boolean).length;

  let summaryText = '';
  if (bullScore >= 3 && bearScore <= 1) {
    summaryText = `Taken together, the current macro backdrop leans constructive. A functioning credit market, stable employment, and improving inflation trajectory provide a reasonable foundation for the economy to continue expanding. This does not mean risk-free — no environment is — but investors do not need to be in full defensive mode. The base case is continued, if uneven, growth with the Fed eventually providing relief on rates as inflation cools further.`;
  } else if (bearScore >= 3 || (ycInverted && creditStressed)) {
    summaryText = `On balance, the current macroeconomic picture presents meaningful headwinds. The combination of restrictive monetary policy, sticky inflation, or signs of credit stress creates a challenging environment for risk assets. History suggests that when multiple warning indicators align — yield curve inversion, tightening credit conditions, slowing labor market — investors benefit from raising cash, reducing leverage, and tilting toward defensive positioning until the picture clarifies.`;
  } else {
    summaryText = `The current macroeconomic picture is genuinely mixed — some indicators are supportive while others warrant caution. This kind of environment calls for selectivity rather than broad bets. Sectors with pricing power, strong balance sheets, and recurring revenue tend to hold up better when macro uncertainty is elevated. It is not a moment to be either fully aggressive or fully defensive — it is a moment for disciplined, stock-by-stock thinking.`;
  }
  sections.push({ title: 'The Bottom Line', text: summaryText, highlight: true });

  return (
    <div className="eco-essay">
      <div className="detail-section-title">Economic Analysis</div>
      {sections.map((s, i) => (
        <div key={i} className={`eco-section${s.highlight ? ' eco-highlight' : ''}`}>
          <div className="eco-section-title">{s.title}</div>
          <p className="eco-section-text">{s.text}</p>
        </div>
      ))}
    </div>
  );
}

function MarketBriefing() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/market-briefing`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  if (loading) return <div className="briefing-loading">Loading market briefing...</div>;
  if (error || !data) return null;

  return (
    <div className="market-briefing">
      <div className="briefing-header">
        <span className="briefing-title">Market Briefing</span>
        {data.topTheme && <span className="briefing-theme">{data.topTheme}</span>}
        {data.updatedAt && <span className="briefing-time">{new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
      <div className="briefing-body">
        {data.paragraph1 && <p className="briefing-para">{data.paragraph1}</p>}
        {data.paragraph2 && <p className="briefing-para">{data.paragraph2}</p>}
        {data.paragraph3 && <p className="briefing-para">{data.paragraph3}</p>}
      </div>
      {data.headlines?.length > 0 && (
        <div className="briefing-sources">
          <div className="briefing-sources-label">Sources</div>
          {data.headlines.map((n, i) => (
            <div key={i} className="news-item">
              <a className="news-headline" href={n.url} target="_blank" rel="noopener noreferrer">{n.headline}</a>
              <span className="news-meta">
                <span className="news-source">{n.source}</span>
                {n.time && <span className="news-time">{n.time}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SENTIMENT_COLORS = {
  Bullish: 'var(--green)', Optimistic: 'var(--green)',
  Neutral: 'var(--amber)',
  Cautious: 'var(--red)', Bearish: 'var(--red)'
};

function MacroReport() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/macro-report`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setReport(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="macro-report-loading">
      <div className="analysis-loading">Generating macro report...</div>
    </div>
  );
  if (error || !report) return null;

  const sentimentColor = SENTIMENT_COLORS[report.sentiment] || 'var(--amber)';

  return (
    <div className="macro-report">
      {/* Header */}
      <div className="macro-report-header" style={{ borderLeftColor: sentimentColor }}>
        <div className="macro-report-title">Macro Economic Report</div>
        <div className="macro-sentiment-row">
          <span className="macro-sentiment-badge" style={{ color: sentimentColor, borderColor: sentimentColor }}>
            {report.sentiment?.toUpperCase()}
          </span>
          <span className="macro-sentiment-reason">{report.sentimentReason}</span>
        </div>
      </div>

      {/* Overview */}
      <div className="macro-section">
        <div className="macro-section-label">Overview</div>
        <p className="macro-text">{report.overview}</p>
      </div>

      {/* What's Driving */}
      <div className="macro-section">
        <div className="macro-section-label">What's Driving Markets</div>
        <p className="macro-text">{report.whatsDriving}</p>
      </div>

      {/* Two-col: Inflation+Rates / Labor */}
      <div className="macro-two-col">
        <div className="macro-section">
          <div className="macro-section-label">Inflation & Interest Rates</div>
          <p className="macro-text">{report.inflationAndRates}</p>
        </div>
        <div className="macro-section">
          <div className="macro-section-label">Labor Market</div>
          <p className="macro-text">{report.laborMarket}</p>
        </div>
      </div>

      {/* Credit */}
      <div className="macro-section">
        <div className="macro-section-label">Credit & Liquidity</div>
        <p className="macro-text">{report.creditAndLiquidity}</p>
      </div>

      {/* Risks & Opportunities */}
      <div className="macro-two-col">
        <div className="macro-section">
          <div className="macro-section-label" style={{ color: 'var(--red)' }}>Risks to Watch</div>
          {report.risks?.map((r, i) => (
            <div key={i} className="macro-bullet bear">
              <span className="macro-bullet-num">{i + 1}</span>
              <span>{r}</span>
            </div>
          ))}
        </div>
        <div className="macro-section">
          <div className="macro-section-label" style={{ color: 'var(--green)' }}>Opportunities</div>
          {report.opportunities?.map((o, i) => (
            <div key={i} className="macro-bullet bull">
              <span className="macro-bullet-num">{i + 1}</span>
              <span>{o}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Line */}
      <div className="macro-bottom-line" style={{ borderLeftColor: sentimentColor }}>
        <div className="macro-section-label">Bottom Line</div>
        <p className="macro-text">{report.bottomLine}</p>
      </div>

      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
        AI-generated macro analysis · Updated every 2 hours · Not financial advice
      </div>
    </div>
  );
}

function StockDetail({ detail }) {
  const up = (detail.changePct ?? 0) >= 0;
  const w52Pct = (detail.fiftyTwoWeekHigh && detail.fiftyTwoWeekLow && detail.fiftyTwoWeekHigh !== detail.fiftyTwoWeekLow)
    ? ((detail.price - detail.fiftyTwoWeekLow) / (detail.fiftyTwoWeekHigh - detail.fiftyTwoWeekLow)) * 100
    : null;

  const valuation = [
    { label: 'P/E Ratio (TTM)', value: detail.trailingPE != null ? fmt(detail.trailingPE) : '—' },
    { label: 'Forward P/E', value: detail.forwardPE != null ? fmt(detail.forwardPE) : '—' },
    { label: 'Price/Book', value: detail.priceToBook != null ? fmt(detail.priceToBook) : '—' },
    { label: 'EV/EBITDA', value: detail.enterpriseToEbitda != null ? fmt(detail.enterpriseToEbitda) : '—' },
    { label: 'PEG Ratio', value: detail.pegRatio != null ? fmt(detail.pegRatio) : '—' },
    { label: 'Dividend Yield', value: detail.dividendYield != null ? `${fmt(detail.dividendYield)}%` : '—' },
  ];
  const keyStats = [
    { label: 'Market Cap', value: fmtCap(detail.marketCap) },
    { label: 'Beta', value: detail.beta != null ? fmt(detail.beta) : '—' },
    { label: '52W High', value: detail.fiftyTwoWeekHigh != null ? fmt(detail.fiftyTwoWeekHigh) : '—' },
    { label: '52W Low', value: detail.fiftyTwoWeekLow != null ? fmt(detail.fiftyTwoWeekLow) : '—' },
    { label: 'Volume', value: fmtVol(detail.volume) },
    { label: 'Avg Volume', value: fmtVol(detail.avgVolume) },
  ];

  return (
    <div className="stock-detail">
      {/* Header */}
      <div className="stock-detail-header">
        <div className="stock-detail-name">
          <span className="sdh-symbol">{detail.symbol}</span>
          <span className="sdh-name">{detail.name}</span>
          {(detail.exchange || detail.sector) && (
            <span className="sdh-meta">
              {[detail.exchange, detail.sector, detail.industry].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
        <div className="stock-detail-price">
          <span className="sdp-price">{fmt(detail.price)}</span>
          <span className={`sdp-change ${up ? 'up' : 'down'}`}>
            {up ? '+' : ''}{fmt(detail.change)} ({fmtPct(detail.changePct)})
          </span>
        </div>
      </div>

      {/* 52-week range bar */}
      {w52Pct != null && (
        <div className="sc-range-wrap" style={{ padding: '10px 0 4px' }}>
          <span className="sc-range-lo">{fmt(detail.fiftyTwoWeekLow)}</span>
          <div className="sc-range-bar">
            <div className="sc-range-track">
              <div className="sc-range-dot" style={{ left: `${Math.min(Math.max(w52Pct, 0), 100)}%` }} />
            </div>
          </div>
          <span className="sc-range-hi">{fmt(detail.fiftyTwoWeekHigh)}</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8 }}>52W Range</span>
        </div>
      )}

      {/* Chart */}
      <LookupChart symbol={detail.symbol} />

      {/* Data grid */}
      <div className="detail-grid">
        <div className="detail-section">
          <div className="detail-section-title">Valuation</div>
          {valuation.map(r => (
            <div className="detail-row" key={r.label}>
              <span className="detail-label">{r.label}</span>
              <span className="detail-value">{r.value}</span>
            </div>
          ))}
        </div>
        <div className="detail-section">
          <div className="detail-section-title">Key Statistics</div>
          {keyStats.map(r => (
            <div className="detail-row" key={r.label}>
              <span className="detail-label">{r.label}</span>
              <span className="detail-value">{r.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Company description */}
      {detail.longBusinessSummary && (
        <div className="detail-section" style={{ marginTop: 12 }}>
          <div className="detail-section-title">About</div>
          <div className="detail-description">{detail.longBusinessSummary}</div>
        </div>
      )}

      {/* AI Bull/Bear Analysis */}
      <StockAnalysis symbol={detail.symbol} />

      {/* Recent News */}
      {detail.news?.length > 0 && (
        <div className="detail-section news-section">
          <div className="detail-section-title">Recent News</div>
          {detail.news.map((item, i) => <NewsItem key={i} item={item} />)}
        </div>
      )}
    </div>
  );
}

function StockLookup() {
  const [input, setInput] = useState('');
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const search = async (sym) => {
    const s = (sym || input).toUpperCase().trim();
    if (!s) return;
    setLoading(true);
    setError(null);
    setDetail(null);
    try {
      const res = await fetch(`${API_BASE}/quote-detail?symbol=${s}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      setDetail(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard">
      <div className="lookup-search-wrap">
        <div className="lookup-search-bar">
          <input
            className="lookup-input"
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="Enter ticker symbol (e.g. AAPL, TSLA, SPY)"
            spellCheck={false}
            autoComplete="off"
          />
          <button className="lookup-btn" onClick={() => search()} disabled={loading}>
            {loading ? '...' : 'SEARCH'}
          </button>
        </div>
        <div className="lookup-suggestions">
          {['AAPL','TSLA','NVDA','MSFT','AMZN','META','GOOGL','SPY','QQQ','BTC-USD'].map(s => (
            <button key={s} className="lookup-pill" onClick={() => { setInput(s); search(s); }}>{s}</button>
          ))}
        </div>
      </div>

      {error && (
        <div className="error-banner">No data found for "{input}". Check the ticker and try again.</div>
      )}

      {loading && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
          Loading {input}...
        </div>
      )}

      {detail && !loading && <StockDetail detail={detail} />}

      {!detail && !loading && !error && (
        <div className="lookup-empty">
          <div className="lookup-empty-icon">🔍</div>
          <div>Search any stock, ETF, or crypto ticker above</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Valuation metrics, key statistics, and price charts
          </div>
        </div>
      )}
    </div>
  );
}

// Loading skeleton
function LoadingSkeleton() {
  return (
    <div className="dashboard">
      <div className="skeleton skeleton-hero" />
      <div className="panels-grid">
        {[1,2,3,4,5].map(i => <div key={i} className="skeleton skeleton-panel" />)}
      </div>
      <div className="skeleton" style={{ height: 200, marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 120, marginBottom: 16 }} />
    </div>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [fred, setFred] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('swing');
  const [tab, setTab] = useState('market');
  const intervalRef = useRef(null);

  // Theme
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);
  const toggleTheme = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), []);

  // Watchlist
  const [watchlist, setWatchlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem('watchlist')) || []; } catch { return []; }
  });
  const [watchlistData, setWatchlistData] = useState(null);

  useEffect(() => {
    localStorage.setItem('watchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  // Alerts
  const [alerts, setAlerts] = useState([]);
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  const prevScoreRef = useRef(null);
  const prevDecisionRef = useRef(null);

  const requestNotifPermission = useCallback(() => {
    if (typeof Notification !== 'undefined') {
      Notification.requestPermission().then(p => setNotifPermission(p));
    }
  }, []);

  const dismissAlert = useCallback((idx) => {
    setAlerts(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [marketRes, fredRes] = await Promise.all([
        fetch(`${API_BASE}/market?mode=${mode}`),
        fetch(`${API_BASE}/fred`)
      ]);
      if (!marketRes.ok) throw new Error(`Market HTTP ${marketRes.status}`);
      const marketJson = await marketRes.json();
      setData(marketJson);
      if (fredRes.ok) setFred(await fredRes.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [mode]);

  // Fetch watchlist data separately
  useEffect(() => {
    if (!watchlist.length) { setWatchlistData(null); return; }
    const fetchWL = async () => {
      try {
        const res = await fetch(`${API_BASE}/quote?symbols=${watchlist.join(',')}`);
        if (res.ok) setWatchlistData(await res.json());
      } catch {}
    };
    fetchWL();
    const id = setInterval(fetchWL, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [watchlist]);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [fetchData]);

  // Alert detection
  const scored = data?.scored;
  const raw = data?.raw;

  useEffect(() => {
    if (!scored) return;
    const newScore = scored.marketQuality;
    const newDecision = scored.decision;
    const prev = prevScoreRef.current;
    const prevDec = prevDecisionRef.current;
    const newAlerts = [];

    if (prev !== null) {
      if (prev < 80 && newScore >= 80) newAlerts.push({ type: 'positive', msg: `Score crossed above 80 (${newScore}%)`, ts: Date.now() });
      if (prev >= 80 && newScore < 80) newAlerts.push({ type: 'warning', msg: `Score dropped below 80 (${newScore}%)`, ts: Date.now() });
      if (prev >= 60 && newScore < 60) newAlerts.push({ type: 'danger', msg: `Score dropped below 60 (${newScore}%)`, ts: Date.now() });
      if (prev < 60 && newScore >= 60) newAlerts.push({ type: 'positive', msg: `Score recovered above 60 (${newScore}%)`, ts: Date.now() });
      if (prevDec && prevDec !== newDecision) {
        newAlerts.push({
          type: newDecision === 'YES' ? 'positive' : newDecision === 'NO' ? 'danger' : 'warning',
          msg: `Decision changed: ${prevDec} → ${newDecision}`,
          ts: Date.now()
        });
      }
    }

    if (newAlerts.length > 0) {
      setAlerts(prev => [...newAlerts, ...prev].slice(0, 10));
      if (notifPermission === 'granted' && typeof Notification !== 'undefined') {
        newAlerts.forEach(a => new Notification('Market Dashboard', { body: a.msg }));
      }
    }

    prevScoreRef.current = newScore;
    prevDecisionRef.current = newDecision;
  }, [scored?.marketQuality, scored?.decision, notifPermission]);

  return (
    <>
      <TickerBar
        quotes={raw?.quotes}
        fetchedAt={data?.fetchedAt}
        onRefresh={fetchData}
        loading={loading}
        mode={mode}
        onModeChange={setMode}
        tab={tab}
        onTabChange={setTab}
        notifPermission={notifPermission}
        onRequestNotif={requestNotifPermission}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <AlertBanner fomc={raw?.macro?.fomc} />
      <AlertToast alerts={alerts} onDismiss={dismissAlert} />

      {error && !data && (
        <div className="error-banner">
          Failed to load market data: {error}. Retrying...
        </div>
      )}

      {!data && loading ? (
        <LoadingSkeleton />
      ) : tab === 'lookup' ? (
        <StockLookup />
      ) : tab === 'economic' ? (
        <EconomicTab fred={fred} />
      ) : data ? (
        <div className="dashboard">
          {/* Hero */}
          <div className="hero">
            <div className="hero-decision">
              <div className="label">Should I Be Trading?</div>
              <div className={`badge ${scored?.decision}`}>{scored?.decision || '--'}</div>
              <div className="advice">{scored?.advice}</div>
            </div>
            <HeroIntraday data={raw?.spyIntraday} spyPrice={raw?.quotes?.SPY?.price} />
            <ScoreRing score={scored?.marketQuality || 0} label="Market Quality Score" />
            <ExecutionWindow exec={scored?.executionWindow} />
          </div>

          {/* Score History */}
          <ScoreHistoryChart history={data?.scoreHistory} />

          {/* Category Panels */}
          <div className="panels-grid">
            <CategoryPanel title="Volatility" data={scored?.categories?.volatility} />
            <CategoryPanel title="Trend" data={scored?.categories?.trend} />
            <CategoryPanel title="Breadth" data={scored?.categories?.breadth} />
            <CategoryPanel title="Momentum" data={scored?.categories?.momentum} />
            <CategoryPanel title="Macro" data={scored?.categories?.macro} />
          </div>

          {/* Sector Heatmap */}
          <SectorHeatmap sectors={raw?.momentum?.sectors} />

          {/* Screener */}
          <HottestNames />

          {/* Watchlist */}
          <WatchlistPanel
            watchlist={watchlist}
            setWatchlist={setWatchlist}
            watchlistData={watchlistData}
          />

          {/* Bottom: Breakdown + Summary */}
          <div className="bottom-grid">
            <ScoringBreakdown categories={scored?.categories} weights={scored?.weights} />
            <div className="summary-panel">
              <div className="panel-title">TERMINAL ANALYSIS</div>
              <div className="summary-text">{scored?.summary}</div>
              <div style={{ marginTop: 12, fontSize: 10, color: 'var(--text-muted)' }}>
                Mode: {scored?.mode?.toUpperCase() || 'SWING'} | Refresh: 45s
              </div>
            </div>
          </div>

          {/* Market Outlook */}
          <MarketOutlook scored={scored} />

          {/* AI Market Briefing */}
          <MarketBriefing />

          {/* Market News */}
          <MarketNews />
        </div>
      ) : null}
    </>
  );
}

export default App;
