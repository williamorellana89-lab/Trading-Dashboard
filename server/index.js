import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchAllMarketData, fetchChart, fetchDailyQuote, calcRSI, calcSMA, fetchScreener, fetchTrending } from './data/fetcher.js';
import { fetchFredData } from './data/fred.js';
import { computeScores } from './scoring/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;

// In dev allow localhost frontend; in prod we serve the frontend ourselves (same origin)
app.use(cors({
  origin: IS_PROD ? false : ['http://localhost:5173', 'http://localhost:5174']
}));
app.use(express.json());

// Serve built frontend in production
if (IS_PROD) {
  const staticPath = path.join(__dirname, '../client/dist');
  app.use(express.static(staticPath));
}

// Server-side caches
let marketCache = { data: null, timestamp: 0 };
let fredCache = { data: null, timestamp: 0 };
let screenerCache = {}; // per-screen cache
let watchlistCache = {}; // per-symbol cache
const MARKET_CACHE_TTL = 30_000;
const FRED_CACHE_TTL = 300_000; // 5 min — FRED data updates daily, not intraday
const SCREENER_CACHE_TTL = 60_000; // 1 min — screener data changes frequently
const WATCHLIST_CACHE_TTL = 30_000;

// Score history (in-memory, max 200 entries)
let scoreHistory = [];
const MAX_SCORE_HISTORY = 200;

const VALID_SCREENS = ['most_actives', 'day_gainers', 'day_losers', 'trending', 'w52_gainers', 'w52_losers'];

async function getMarketData() {
  const now = Date.now();
  if (marketCache.data && (now - marketCache.timestamp) < MARKET_CACHE_TTL) {
    return marketCache.data;
  }

  try {
    // Fetch market data and FRED data in parallel for enhanced scoring
    const [raw, fredData] = await Promise.all([
      fetchAllMarketData(),
      getFredData().catch(() => null) // FRED is optional — don't block market data
    ]);
    const scored = computeScores(raw, 'swing', fredData);

    // Track score history
    scoreHistory.push({
      timestamp: new Date().toISOString(),
      score: scored.marketQuality,
      decision: scored.decision
    });
    if (scoreHistory.length > MAX_SCORE_HISTORY) {
      scoreHistory = scoreHistory.slice(-MAX_SCORE_HISTORY);
    }

    marketCache = { data: { raw, scored, scoreHistory, fetchedAt: new Date().toISOString() }, timestamp: now };
    return marketCache.data;
  } catch (err) {
    console.error('Error fetching market data:', err.message);
    if (marketCache.data) return marketCache.data;
    throw err;
  }
}

async function getFredData() {
  const now = Date.now();
  if (fredCache.data && (now - fredCache.timestamp) < FRED_CACHE_TTL) {
    return fredCache.data;
  }

  try {
    const data = await fetchFredData();
    fredCache = { data, timestamp: now };
    return data;
  } catch (err) {
    console.error('Error fetching FRED data:', err.message);
    if (fredCache.data) return fredCache.data;
    throw err;
  }
}

async function getScreenerData(screen) {
  const now = Date.now();
  const cached = screenerCache[screen];
  if (cached?.data && (now - cached.timestamp) < SCREENER_CACHE_TTL) {
    return cached.data;
  }

  try {
    let data;
    if (screen === 'trending') {
      data = await fetchTrending(25);
    } else if (screen === 'w52_gainers') {
      // Fetch most_actives (large pool) and sort by 52-week change descending
      const pool = await fetchScreener('most_actives', 100);
      if (pool) {
        data = pool
          .filter(q => q.w52Change != null && q.w52Change > 0)
          .sort((a, b) => b.w52Change - a.w52Change)
          .slice(0, 25);
      }
    } else if (screen === 'w52_losers') {
      const pool = await fetchScreener('most_actives', 100);
      if (pool) {
        data = pool
          .filter(q => q.w52Change != null && q.w52Change < 0)
          .sort((a, b) => a.w52Change - b.w52Change)
          .slice(0, 25);
      }
    } else {
      data = await fetchScreener(screen, 25);
    }

    if (data) {
      screenerCache[screen] = { data, timestamp: now };
    }
    return data || [];
  } catch (err) {
    console.error(`Error fetching screener ${screen}:`, err.message);
    if (cached?.data) return cached.data;
    throw err;
  }
}

app.get('/api/market', async (req, res) => {
  try {
    const data = await getMarketData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch market data', details: err.message });
  }
});

app.get('/api/fred', async (req, res) => {
  try {
    const data = await getFredData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch FRED data', details: err.message });
  }
});

app.get('/api/screener', async (req, res) => {
  const screen = req.query.screen || 'most_actives';
  if (!VALID_SCREENS.includes(screen)) {
    return res.status(400).json({ error: `Invalid screen. Valid: ${VALID_SCREENS.join(', ')}` });
  }
  try {
    const data = await getScreenerData(screen);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch screener data', details: err.message });
  }
});

app.get('/api/quote', async (req, res) => {
  const symbols = (req.query.symbols || '').split(',').filter(Boolean).slice(0, 20);
  if (!symbols.length) return res.json([]);

  try {
    const now = Date.now();
    const results = await Promise.all(
      symbols.map(async (sym) => {
        const cached = watchlistCache[sym];
        if (cached && (now - cached.timestamp) < WATCHLIST_CACHE_TTL) return cached.data;

        try {
          const [quote, chart] = await Promise.all([
            fetchDailyQuote(sym),
            fetchChart(sym, '3mo', '1d')
          ]);
          if (!quote) return null;

          const closes = chart?.bars?.map(b => b.close) || [];
          const rsi = calcRSI(closes);
          const sma50 = calcSMA(closes, 50);

          const data = {
            symbol: sym,
            price: quote.regularMarketPrice,
            change: quote.regularMarketChangePercent,
            rsi: rsi ? Math.round(rsi) : null,
            aboveSMA50: sma50 ? quote.regularMarketPrice > sma50 : null
          };

          watchlistCache[sym] = { data, timestamp: now };
          return data;
        } catch { return null; }
      })
    );

    res.json(results.filter(Boolean));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch quote data', details: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    marketCacheAge: marketCache.timestamp ? Date.now() - marketCache.timestamp : null,
    fredCacheAge: fredCache.timestamp ? Date.now() - fredCache.timestamp : null,
    scoreHistoryLength: scoreHistory.length
  });
});

// SPA catch-all — must be after all /api routes
if (IS_PROD) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Market Dashboard API running on port ${PORT} [${IS_PROD ? 'production' : 'development'}]`);
});
