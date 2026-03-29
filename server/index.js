import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchAllMarketData, fetchChart, fetchDailyQuote, calcRSI, calcSMA, fetchScreener, fetchTrending, fetchQuoteSummary, fetchMarketNews } from './data/fetcher.js';
import Anthropic from '@anthropic-ai/sdk';
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
let detailCache = {};   // per-symbol quote detail cache
let chartCache = {};    // per-symbol+range chart cache
let analysisCache = {}; // per-symbol AI analysis cache
let marketNewsCache = { data: null, timestamp: 0 };
const MARKET_CACHE_TTL = 30_000;
const FRED_CACHE_TTL = 300_000; // 5 min — FRED data updates daily, not intraday
const SCREENER_CACHE_TTL = 60_000; // 1 min — screener data changes frequently
const WATCHLIST_CACHE_TTL = 30_000;
const DETAIL_CACHE_TTL = 30_000;
const CHART_CACHE_TTL = 60_000;
const ANALYSIS_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours
const MARKET_NEWS_CACHE_TTL = 5 * 60 * 1000;   // 5 minutes

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

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

app.get('/api/quote-detail', async (req, res) => {
  const symbol = (req.query.symbol || '').toUpperCase().trim();
  if (!symbol || !/^[A-Z0-9.\-\^]{1,10}$/.test(symbol)) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }

  const now = Date.now();
  const cached = detailCache[symbol];
  if (cached && (now - cached.timestamp) < DETAIL_CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    // Try quoteSummary first; fall back to chart-based data if auth-gated
    const [summary, chart1y, chartIntraday] = await Promise.all([
      fetchQuoteSummary(symbol),
      fetchChart(symbol, '1y', '1d'),
      fetchChart(symbol, '1d', '5m')
    ]);

    let detail;
    if (summary && summary.price) {
      detail = {
        ...summary,
        news: summary.news || [],
        intraDayBars: chartIntraday?.bars?.map(b => ({ t: b.date, c: b.close })) || [],
      };
    } else {
      // YF auth-gated: build price from chart, merge valuation from summary (Finviz)
      const quote = await fetchDailyQuote(symbol);
      if (!quote) return res.status(404).json({ error: `No data found for ${symbol}` });
      const bars = chart1y?.bars || [];
      const meta = chart1y?.meta || {};
      const w52High = meta.fiftyTwoWeekHigh || (bars.length ? Math.max(...bars.map(b => b.high)) : null);
      const w52Low = meta.fiftyTwoWeekLow || (bars.length ? Math.min(...bars.map(b => b.low)) : null);
      const last60 = bars.slice(-60);
      const avgVol = last60.length ? Math.round(last60.reduce((s, b) => s + b.volume, 0) / last60.length) : null;
      detail = {
        symbol,
        name: (summary?.name && summary.name !== symbol) ? summary.name : (meta.longName || meta.shortName || symbol),
        exchange: null, currency: 'USD',
        price: quote.regularMarketPrice,
        change: quote.regularMarketPrice - quote.regularMarketPreviousClose,
        changePct: quote.regularMarketChangePercent,
        previousClose: quote.regularMarketPreviousClose,
        open: null, dayHigh: null, dayLow: null,
        marketCap: summary?.marketCap ?? null,
        volume: bars.length ? bars[bars.length - 1].volume : null,
        avgVolume: summary?.avgVolume ?? avgVol,
        beta: summary?.beta ?? null,
        fiftyTwoWeekHigh: w52High, fiftyTwoWeekLow: w52Low,
        fiftyDayAverage: null, twoHundredDayAverage: null,
        dividendYield: summary?.dividendYield ?? null,
        trailingPE: summary?.trailingPE ?? null,
        forwardPE: summary?.forwardPE ?? null,
        priceToBook: summary?.priceToBook ?? null,
        enterpriseToEbitda: summary?.enterpriseToEbitda ?? null,
        pegRatio: summary?.pegRatio ?? null,
        priceToSalesTrailing12Months: summary?.priceToSalesTrailing12Months ?? null,
        sector: summary?.sector ?? null,
        industry: summary?.industry ?? null,
        longBusinessSummary: null,
        fullTimeEmployees: summary?.fullTimeEmployees ?? null,
        news: summary?.news || [],
        intraDayBars: chartIntraday?.bars?.map(b => ({ t: b.date, c: b.close })) || [],
      };
    }

    detailCache[symbol] = { data: detail, timestamp: now };
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch quote detail', details: err.message });
  }
});

app.get('/api/chart', async (req, res) => {
  const symbol = (req.query.symbol || '').toUpperCase().trim();
  const range = req.query.range || '1d';
  const interval = req.query.interval || '5m';

  if (!symbol || !/^[A-Z0-9.\-\^]{1,10}$/.test(symbol)) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }
  const validRanges = ['1d', '5d', '1mo', '3mo', '1y'];
  if (!validRanges.includes(range)) return res.status(400).json({ error: 'Invalid range' });

  const cacheKey = `${symbol}:${range}:${interval}`;
  const now = Date.now();
  const cached = chartCache[cacheKey];
  if (cached && (now - cached.timestamp) < CHART_CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    const chart = await fetchChart(symbol, range, interval);
    if (!chart) return res.status(404).json({ error: `No chart data for ${symbol}` });

    const data = {
      bars: chart.bars.map(b => ({ t: b.date, c: b.close, h: b.high, l: b.low, v: b.volume })),
      meta: chart.meta
    };
    chartCache[cacheKey] = { data, timestamp: now };
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch chart data', details: err.message });
  }
});

app.get('/api/market-news', async (req, res) => {
  const now = Date.now();
  if (marketNewsCache.data && (now - marketNewsCache.timestamp) < MARKET_NEWS_CACHE_TTL) {
    return res.json(marketNewsCache.data);
  }
  try {
    const news = await fetchMarketNews();
    marketNewsCache = { data: news, timestamp: now };
    res.json(news);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch market news', details: err.message });
  }
});

app.get('/api/analysis', async (req, res) => {
  const symbol = (req.query.symbol || '').toUpperCase().trim();
  if (!symbol || !/^[A-Z0-9.\-\^]{1,10}$/.test(symbol)) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }

  if (!anthropic) {
    return res.status(503).json({ error: 'AI analysis unavailable: ANTHROPIC_API_KEY not set' });
  }

  const now = Date.now();
  const cached = analysisCache[symbol];
  if (cached && (now - cached.timestamp) < ANALYSIS_CACHE_TTL) {
    return res.json(cached.data);
  }

  // Grab latest detail data to inform analysis
  const detail = detailCache[symbol]?.data || null;
  if (!detail) {
    return res.status(404).json({ error: 'Fetch quote detail first before requesting analysis' });
  }

  try {
    const pctOf52W = detail.fiftyTwoWeekHigh && detail.fiftyTwoWeekLow
      ? Math.round(((detail.price - detail.fiftyTwoWeekLow) / (detail.fiftyTwoWeekHigh - detail.fiftyTwoWeekLow)) * 100)
      : null;

    const prompt = `You are a concise financial analyst. Given this stock data, respond with ONLY valid JSON (no markdown, no explanation):

Symbol: ${symbol}
Company: ${detail.name}
Sector: ${detail.sector || 'N/A'} | Industry: ${detail.industry || 'N/A'}
Price: $${detail.price?.toFixed(2)} (${detail.changePct?.toFixed(2)}% today)
Market Cap: ${detail.marketCap ? '$' + (detail.marketCap / 1e9).toFixed(1) + 'B' : 'N/A'}
P/E (TTM): ${detail.trailingPE ?? 'N/A'} | Fwd P/E: ${detail.forwardPE ?? 'N/A'} | PEG: ${detail.pegRatio ?? 'N/A'}
P/B: ${detail.priceToBook ?? 'N/A'} | EV/EBITDA: ${detail.enterpriseToEbitda ?? 'N/A'} | P/S: ${detail.priceToSalesTrailing12Months ?? 'N/A'}
Beta: ${detail.beta ?? 'N/A'} | Dividend Yield: ${detail.dividendYield ? detail.dividendYield + '%' : 'None'}
52W Range: $${detail.fiftyTwoWeekLow} - $${detail.fiftyTwoWeekHigh} (currently ${pctOf52W ?? '?'}% of range)

Return exactly this JSON structure:
{
  "bullCase": "2-3 sentence bull case for this stock",
  "bearCase": "2-3 sentence bear case for this stock",
  "bullCatalysts": ["catalyst 1", "catalyst 2", "catalyst 3"],
  "bearCatalysts": ["risk 1", "risk 2", "risk 3"]
}`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = message.content[0]?.text || '{}';
    const data = JSON.parse(text);
    analysisCache[symbol] = { data, timestamp: now };
    res.json(data);
  } catch (err) {
    console.error(`Analysis error for ${symbol}:`, err.message);
    res.status(500).json({ error: 'Analysis failed', details: err.message });
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
