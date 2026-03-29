// Yahoo Finance data fetcher
// Uses v8 chart endpoint (no auth) for price data and yahoo-finance2 for fundamentals
import yahooFinance from 'yahoo-finance2';

const SECTOR_ETFS = {
  XLK: 'Technology', XLF: 'Financials', XLE: 'Energy', XLV: 'Healthcare',
  XLI: 'Industrials', XLY: 'Consumer Disc', XLP: 'Consumer Staples',
  XLU: 'Utilities', XLB: 'Materials', XLRE: 'Real Estate', XLC: 'Communication'
};

// All symbols fetched via chart v8 endpoint (no auth needed)
const ALL_CHART_SYMBOLS = {
  SPY: '1y', QQQ: '6mo', '^VIX': '1y', '^VVIX': '5d', '^TNX': '3mo', 'DX-Y.NYB': '1mo',
  ...Object.fromEntries(Object.keys(SECTOR_ETFS).map(s => [s, '5d']))
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

// ── Math helpers ──

function calcSMA(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
}

function calcSlope(values, period = 5) {
  if (values.length < period) return 0;
  const slice = values.slice(-period);
  const n = slice.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += slice[i]; sumXY += i * slice[i]; sumX2 += i * i;
  }
  return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
}

function calcPercentile(values, currentValue) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = sorted.findIndex(v => v >= currentValue);
  if (idx === -1) return 100;
  return Math.round((idx / sorted.length) * 100);
}

// ── Yahoo Finance API ──

async function fetchChart(symbol, range = '1y', interval = '1d') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      console.warn(`Chart API ${res.status} for ${symbol}`);
      return null;
    }
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const meta = result.meta || {};

    const bars = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (quote.close?.[i] != null) {
        bars.push({
          date: new Date(timestamps[i] * 1000).toISOString(),
          close: quote.close[i],
          high: quote.high?.[i] ?? quote.close[i],
          low: quote.low?.[i] ?? quote.close[i],
          volume: quote.volume?.[i] ?? 0
        });
      }
    }

    return {
      bars,
      meta: {
        regularMarketPrice: meta.regularMarketPrice,
        chartPreviousClose: meta.chartPreviousClose,
        previousClose: meta.previousClose,
        symbol: meta.symbol,
        longName: meta.longName,
        shortName: meta.shortName,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow
      }
    };
  } catch (e) {
    console.warn(`Chart fetch error for ${symbol}:`, e.message);
    return null;
  }
}

// Fetch a 1d chart for current price + prev close (accurate daily change)
// IMPORTANT: range=1d gives chartPreviousClose as yesterday's close
// range=5d gives chartPreviousClose as 5-days-ago close (wrong for daily %)
async function fetchDailyQuote(symbol) {
  const chart = await fetchChart(symbol, '1d', '1d');
  if (!chart) return null;
  const { meta, bars } = chart;
  const price = meta.regularMarketPrice || (bars.length ? bars[bars.length - 1].close : 0);
  const prevClose = meta.chartPreviousClose || (bars.length >= 2 ? bars[bars.length - 2].close : price);
  const changePct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
  return { regularMarketPrice: price, regularMarketChangePercent: changePct, regularMarketPreviousClose: prevClose };
}

// Fetch sector performance across multiple timeframes
async function fetchSectorTimeframes(symbol) {
  const [d1, w1, m1, m3] = await Promise.all([
    fetchChart(symbol, '1d', '1d'),
    fetchChart(symbol, '5d', '1d'),
    fetchChart(symbol, '1mo', '1d'),
    fetchChart(symbol, '3mo', '1d'),
  ]);

  function pctChange(chart) {
    if (!chart) return null;
    const price = chart.meta.regularMarketPrice || (chart.bars.length ? chart.bars[chart.bars.length - 1].close : 0);
    const base = chart.meta.chartPreviousClose || (chart.bars.length ? chart.bars[0].close : price);
    return base ? ((price - base) / base) * 100 : 0;
  }

  return {
    '1D': pctChange(d1),
    '1W': pctChange(w1),
    '1M': pctChange(m1),
    '3M': pctChange(m3),
  };
}

function classifyRegime(spyCloses, sma20, sma50, sma200) {
  if (!sma20 || !sma50 || !sma200 || spyCloses.length === 0) return 'chop';
  const price = spyCloses[spyCloses.length - 1];
  const aboveSMA = [price > sma20, price > sma50, price > sma200].filter(Boolean).length;
  const smaAligned = sma20 > sma50 && sma50 > sma200;
  const smaInverted = sma20 < sma50 && sma50 < sma200;

  if (aboveSMA >= 2 && smaAligned) return 'uptrend';
  if (aboveSMA <= 1 && smaInverted) return 'downtrend';
  return 'chop';
}

// FOMC dates for 2025-2026
const FOMC_DATES = [
  '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18',
  '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-17',
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
  '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-16'
];

function checkFOMC() {
  const now = new Date();
  const msIn72h = 72 * 60 * 60 * 1000;
  for (const d of FOMC_DATES) {
    const fomcDate = new Date(d + 'T14:00:00-05:00');
    const diff = fomcDate - now;
    if (diff > -24 * 60 * 60 * 1000 && diff < msIn72h) {
      const isToday = diff > -24 * 60 * 60 * 1000 && diff < 12 * 60 * 60 * 1000;
      return { imminent: true, date: d, isToday, hoursUntil: Math.round(diff / 3600000) };
    }
  }
  return { imminent: false };
}

// ── Yahoo Finance Screener API ──

const SCREENER_IDS = {
  most_actives: 'most_actives',
  day_gainers: 'day_gainers',
  day_losers: 'day_losers',
};

async function fetchScreener(screenId, count = 25) {
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=${screenId}&count=${count}`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      console.warn(`Screener API ${res.status} for ${screenId}`);
      return null;
    }
    const json = await res.json();
    const result = json?.finance?.result?.[0];
    if (!result?.quotes) return null;

    return result.quotes.map(q => ({
      symbol: q.symbol,
      name: q.longName || q.shortName || q.displayName || q.symbol,
      price: q.regularMarketPrice,
      changeDollar: q.regularMarketChange != null ? Math.round(q.regularMarketChange * 100) / 100 : 0,
      change: q.regularMarketChangePercent != null ? Math.round(q.regularMarketChangePercent * 100) / 100 : 0,
      volume: q.regularMarketVolume || 0,
      avgVolume3mo: q.averageDailyVolume3Month || 0,
      marketCap: q.marketCap || null,
      pe: q.trailingPE != null ? Math.round(q.trailingPE * 100) / 100 : null,
      w52High: q.fiftyTwoWeekHigh || null,
      w52Low: q.fiftyTwoWeekLow || null,
      w52Change: q.fiftyTwoWeekChangePercent != null ? Math.round(q.fiftyTwoWeekChangePercent * 100) / 100 : null,
      w52Pct: (q.fiftyTwoWeekHigh && q.fiftyTwoWeekLow && q.fiftyTwoWeekHigh !== q.fiftyTwoWeekLow)
        ? Math.round(((q.regularMarketPrice - q.fiftyTwoWeekLow) / (q.fiftyTwoWeekHigh - q.fiftyTwoWeekLow)) * 100)
        : 50,
    }));
  } catch (e) {
    console.warn(`Screener fetch error for ${screenId}:`, e.message);
    return null;
  }
}

async function fetchTrending(count = 25) {
  const url = `https://query1.finance.yahoo.com/v1/finance/trending/US?count=${count}`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    const json = await res.json();
    const symbols = json?.finance?.result?.[0]?.quotes?.map(q => q.symbol).filter(Boolean).slice(0, count);
    if (!symbols?.length) return null;

    // Use chart v8 API (no auth needed) to get rich data for each trending symbol
    const results = await Promise.all(symbols.map(async (sym) => {
      try {
        const [quote, chart1y] = await Promise.all([
          fetchDailyQuote(sym),
          fetchChart(sym, '1y', '1d')
        ]);
        if (!quote) return null;

        const bars = chart1y?.bars || [];
        const last60 = bars.slice(-60);
        const todayVol = bars.length ? bars[bars.length - 1].volume : 0;
        const avg3moVol = last60.length ? last60.reduce((s, b) => s + b.volume, 0) / last60.length : 0;
        const price = quote.regularMarketPrice;
        const prevClose = quote.regularMarketPreviousClose || price;
        const w52High = chart1y?.meta?.fiftyTwoWeekHigh || (bars.length ? Math.max(...bars.map(b => b.high)) : null);
        const w52Low = chart1y?.meta?.fiftyTwoWeekLow || (bars.length ? Math.min(...bars.map(b => b.low)) : null);
        const yearAgoPrice = bars.length >= 2 ? bars[0].close : null;

        return {
          symbol: sym,
          name: chart1y?.meta?.longName || chart1y?.meta?.shortName || sym,
          price,
          changeDollar: Math.round((price - prevClose) * 100) / 100,
          change: Math.round(quote.regularMarketChangePercent * 100) / 100,
          volume: todayVol,
          avgVolume3mo: Math.round(avg3moVol),
          marketCap: null,
          pe: null,
          w52High,
          w52Low,
          w52Change: yearAgoPrice ? Math.round(((price - yearAgoPrice) / yearAgoPrice) * 10000) / 100 : null,
          w52Pct: (w52High && w52Low && w52High !== w52Low)
            ? Math.round(((price - w52Low) / (w52High - w52Low)) * 100) : 50,
        };
      } catch { return null; }
    }));
    return results.filter(Boolean);
  } catch (e) {
    console.warn('Trending fetch error:', e.message);
    return null;
  }
}

// ── Finviz scraper for valuation metrics ──

function parseFinvizNum(str) {
  if (!str || str === '-') return null;
  const s = str.replace(/[,%]/g, '').trim();
  if (s.endsWith('B')) return parseFloat(s) * 1e9;
  if (s.endsWith('M')) return parseFloat(s) * 1e6;
  if (s.endsWith('K')) return parseFloat(s) * 1e3;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

async function fetchFinvizData(symbol) {
  const url = `https://finviz.com/quote.ashx?t=${encodeURIComponent(symbol)}`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    const html = await res.text();

    // Extract label→value pairs from the snapshot table (handles plain and span-wrapped values)
    const map = {};
    const pat = /data-boxover-html="[^"]*">([^<]+)<\/td><td[^>]*><b>(?:<span[^>]*>)?([^<]*)(?:<\/span>)?<\/b>/g;
    let m;
    while ((m = pat.exec(html)) !== null) {
      map[m[1].trim()] = m[2].trim();
    }

    // Sector and industry are in screener links
    const sectorMatch = html.match(/screener\.ashx\?[^"]*f=sec_[^"]*"[^>]*>([^<]+)<\/a>/);
    const industryMatch = html.match(/screener\.ashx\?[^"]*f=ind_[^"]*"[^>]*title="([^"]+)"/);

    // Compute P/B from price and book-per-share when Finviz doesn't give the ratio directly
    const price = parseFinvizNum(map['Price']);
    const bookPerShare = parseFinvizNum(map['Book/sh']);
    const priceToBook = price && bookPerShare ? parseFloat((price / bookPerShare).toFixed(2)) : null;

    // Extract news items from news-table
    const news = [];
    const newsTableMatch = html.match(/<table[^>]*id="news-table"[^>]*>([\s\S]*?)<\/table>/);
    if (newsTableMatch) {
      const rows = newsTableMatch[1].split('<tr').slice(1);
      let lastDate = '';
      for (const row of rows) {
        if (!row.includes('tab-link-news')) continue;
        const tdMatch = row.match(/<td[^>]*>\s*([\w\-\s:,]+?)\s*<\/td>/);
        const urlMatch = row.match(/href="([^"]+)"/);
        const headlineMatch = row.match(/class="tab-link-news"[^>]*>([^<]+)<\/a>/);
        const sourceMatch = row.match(/<span>\(([^)]+)\)<\/span>/);
        if (!headlineMatch || !urlMatch) continue;
        const timeRaw = tdMatch?.[1]?.trim() || '';
        if (timeRaw.includes('-')) lastDate = timeRaw.split(' ')[0]; // e.g. "Mar-28-26"
        const timeStr = timeRaw.includes('-') ? timeRaw : `${lastDate} ${timeRaw}`;
        news.push({
          headline: headlineMatch[1].trim(),
          url: urlMatch[1],
          source: sourceMatch?.[1]?.trim() || '',
          time: timeStr,
        });
        if (news.length >= 10) break;
      }
    }

    return {
      trailingPE: parseFinvizNum(map['P/E']),
      forwardPE: parseFinvizNum(map['Forward P/E']),
      pegRatio: parseFinvizNum(map['PEG']),
      priceToBook,
      priceToSalesTrailing12Months: parseFinvizNum(map['P/S']),
      enterpriseToEbitda: parseFinvizNum(map['EV/EBITDA']),
      beta: parseFinvizNum(map['Beta']),
      dividendYield: parseFinvizNum(map['Dividend %']) ?? parseFinvizNum(map['Div Rate TTM']),
      marketCap: parseFinvizNum(map['Market Cap']),
      avgVolume: parseFinvizNum(map['Avg Volume']),
      employees: parseFinvizNum(map['Employees']),
      sector: sectorMatch?.[1]?.trim() || null,
      industry: industryMatch?.[1]?.trim() || null,
      news,
    };
  } catch (e) {
    console.warn(`Finviz fetch error for ${symbol}:`, e.message);
    return null;
  }
}

// ── Quote Summary: yahoo-finance2 with Finviz fallback ──

const _yfInstance = new yahooFinance();

async function fetchQuoteSummary(symbol) {
  // Try yahoo-finance2 first (has auth handling)
  let yfData = null;
  try {
    const q = await _yfInstance.quote(symbol);
    if (q && q.regularMarketPrice) {
      const divYield = q.trailingAnnualDividendYield != null
        ? q.trailingAnnualDividendYield * 100 : null;
      yfData = {
        symbol: (q.symbol || symbol).toUpperCase(),
        name: q.longName || q.shortName || symbol.toUpperCase(),
        exchange: q.fullExchangeName || q.exchange || null,
        currency: q.currency || 'USD',
        price: q.regularMarketPrice ?? null,
        change: q.regularMarketChange ?? null,
        changePct: q.regularMarketChangePercent ?? null,
        previousClose: q.regularMarketPreviousClose ?? null,
        open: q.regularMarketOpen ?? null,
        dayHigh: q.regularMarketDayHigh ?? null,
        dayLow: q.regularMarketDayLow ?? null,
        marketCap: q.marketCap ?? null,
        volume: q.regularMarketVolume ?? null,
        avgVolume: q.averageDailyVolume3Month ?? q.averageDailyVolume10Day ?? null,
        beta: q.beta ?? null,
        fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? null,
        fiftyDayAverage: q.fiftyDayAverage ?? null,
        twoHundredDayAverage: q.twoHundredDayAverage ?? null,
        dividendYield: divYield,
        trailingPE: q.trailingPE ?? null,
        forwardPE: q.forwardPE ?? null,
        priceToBook: q.priceToBook ?? null,
        pegRatio: null,
        enterpriseToEbitda: null,
        priceToSalesTrailing12Months: null,
        totalRevenue: null, profitMargins: null, operatingMargins: null,
        returnOnEquity: null, debtToEquity: null, currentRatio: null,
        sector: null, industry: null, longBusinessSummary: null, fullTimeEmployees: null,
      };
    }
  } catch (e) {
    console.warn(`yahoo-finance2 quote error for ${symbol}:`, e.message.slice(0, 80));
  }

  // Always enrich with Finviz (fills in PE, beta, sector, etc. when YF fails)
  const fvData = await fetchFinvizData(symbol);

  if (!yfData && !fvData) return null;

  // Merge: yfData takes priority for price data; fvData fills gaps in valuation
  return {
    symbol: yfData?.symbol || symbol.toUpperCase(),
    name: yfData?.name || symbol.toUpperCase(),
    exchange: yfData?.exchange || null,
    currency: yfData?.currency || 'USD',
    price: yfData?.price ?? null,
    change: yfData?.change ?? null,
    changePct: yfData?.changePct ?? null,
    previousClose: yfData?.previousClose ?? null,
    open: yfData?.open ?? null,
    dayHigh: yfData?.dayHigh ?? null,
    dayLow: yfData?.dayLow ?? null,
    marketCap: yfData?.marketCap ?? fvData?.marketCap ?? null,
    volume: yfData?.volume ?? null,
    avgVolume: yfData?.avgVolume ?? fvData?.avgVolume ?? null,
    beta: yfData?.beta ?? fvData?.beta ?? null,
    fiftyTwoWeekHigh: yfData?.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: yfData?.fiftyTwoWeekLow ?? null,
    fiftyDayAverage: yfData?.fiftyDayAverage ?? null,
    twoHundredDayAverage: yfData?.twoHundredDayAverage ?? null,
    dividendYield: yfData?.dividendYield ?? fvData?.dividendYield ?? null,
    trailingPE: yfData?.trailingPE ?? fvData?.trailingPE ?? null,
    forwardPE: yfData?.forwardPE ?? fvData?.forwardPE ?? null,
    priceToBook: yfData?.priceToBook ?? fvData?.priceToBook ?? null,
    pegRatio: fvData?.pegRatio ?? null,
    priceToSalesTrailing12Months: fvData?.priceToSalesTrailing12Months ?? null,
    enterpriseToEbitda: fvData?.enterpriseToEbitda ?? null,
    totalRevenue: null, profitMargins: null, operatingMargins: null,
    returnOnEquity: null, debtToEquity: null, currentRatio: null,
    sector: fvData?.sector ?? null,
    industry: fvData?.industry ?? null,
    longBusinessSummary: null,
    fullTimeEmployees: fvData?.employees ?? null,
    news: fvData?.news || [],
  };
}

// Fetch market news via SPY + QQQ quote pages (proxy for broad market news)
export async function fetchMarketNews() {
  try {
    const [spyData, qqqData] = await Promise.all([
      fetchFinvizData('SPY'),
      fetchFinvizData('QQQ'),
    ]);
    // Merge and deduplicate by headline
    const seen = new Set();
    const merged = [];
    for (const item of [...(spyData?.news || []), ...(qqqData?.news || [])]) {
      if (!seen.has(item.headline)) {
        seen.add(item.headline);
        merged.push(item);
      }
    }
    return merged.slice(0, 15);
  } catch (e) {
    console.warn('Market news error:', e.message);
    return [];
  }
}

export { fetchChart, fetchDailyQuote, calcRSI, calcSMA, fetchScreener, fetchTrending, fetchQuoteSummary };

export async function fetchAllMarketData() {
  // Fetch ALL data via chart v8 endpoint in parallel (no auth needed)
  const chartResults = {};
  await Promise.all(
    Object.entries(ALL_CHART_SYMBOLS).map(async ([sym, range]) => {
      chartResults[sym] = await fetchChart(sym, range);
    })
  );

  // Fetch accurate daily quotes (range=1d for correct chartPreviousClose)
  const quoteSymbols = ['SPY', 'QQQ', '^VIX', '^VVIX', '^TNX', 'DX-Y.NYB', ...Object.keys(SECTOR_ETFS)];
  const quotes = {};
  const sectorTimeframes = {};
  let spyIntradayChart = null;
  await Promise.all([
    // Daily quotes for all symbols
    ...quoteSymbols.map(async (sym) => {
      quotes[sym] = await fetchDailyQuote(sym);
    }),
    // Multi-timeframe data for sector ETFs
    ...Object.keys(SECTOR_ETFS).map(async (sym) => {
      sectorTimeframes[sym] = await fetchSectorTimeframes(sym);
    }),
    // SPY intraday 5-min bars for mini-chart
    (async () => { spyIntradayChart = await fetchChart('SPY', '1d', '5m'); })()
  ]);

  const spyChart = chartResults['SPY'];
  const qqqChart = chartResults['QQQ'];
  const vixChart = chartResults['^VIX'];
  const sectorCharts = {};
  for (const sym of Object.keys(SECTOR_ETFS)) {
    sectorCharts[sym] = chartResults[sym];
  }

  // ── SPY analysis ──
  const spyBars = spyChart?.bars || [];
  const spyCloses = spyBars.map(d => d.close);
  const spyHighs = spyBars.map(d => d.high);
  const spySMA20 = calcSMA(spyCloses, 20);
  const spySMA50 = calcSMA(spyCloses, 50);
  const spySMA200 = calcSMA(spyCloses, 200);
  const spyRSI = calcRSI(spyCloses);
  const spyPrice = quotes['SPY']?.regularMarketPrice || spyCloses[spyCloses.length - 1] || 0;

  // ── QQQ analysis ──
  const qqqBars = qqqChart?.bars || [];
  const qqqCloses = qqqBars.map(d => d.close);
  const qqqSMA50 = calcSMA(qqqCloses, 50);
  const qqqPrice = quotes['QQQ']?.regularMarketPrice || qqqCloses[qqqCloses.length - 1] || 0;

  // ── VIX analysis ──
  const vixBars = vixChart?.bars || [];
  const vixCloses = vixBars.map(d => d.close);
  const vixCurrent = quotes['^VIX']?.regularMarketPrice || vixCloses[vixCloses.length - 1] || 0;
  const vixSlope = calcSlope(vixCloses, 5);
  const vixPercentile = calcPercentile(vixCloses, vixCurrent);

  // ── Regime ──
  const regime = classifyRegime(spyCloses, spySMA20, spySMA50, spySMA200);

  // ── Sector performance ──
  const sectors = {};
  for (const [sym, name] of Object.entries(SECTOR_ETFS)) {
    const q = quotes[sym];
    if (q && q.regularMarketPrice > 0) {
      sectors[sym] = {
        name,
        price: q.regularMarketPrice,
        change: q.regularMarketChangePercent || 0,
        prevClose: q.regularMarketPreviousClose,
        timeframes: sectorTimeframes[sym] || {}
      };
    }
  }

  const sectorList = Object.entries(sectors)
    .map(([sym, data]) => ({ symbol: sym, ...data }))
    .sort((a, b) => b.change - a.change);

  const topSectors = sectorList.slice(0, 3);
  const bottomSectors = sectorList.slice(-3);
  const sectorSpread = topSectors.length && bottomSectors.length
    ? (topSectors.reduce((s, x) => s + x.change, 0) / topSectors.length) -
      (bottomSectors.reduce((s, x) => s + x.change, 0) / bottomSectors.length)
    : 0;

  // ── Breadth ──
  const sectorsAbove0 = sectorList.filter(s => s.change > 0).length;
  const breadthRatio = sectorsAbove0 / Math.max(sectorList.length, 1);

  // Put/Call ratio estimate from VIX regime
  const putCallEstimate = vixCurrent > 25 ? 1.2 : vixCurrent > 20 ? 1.0 : vixCurrent > 15 ? 0.85 : 0.7;

  // ── Macro ──
  const tnxQuote = quotes['^TNX'];
  const tenYearYield = tnxQuote?.regularMarketPrice || 0;

  const dxyQuote = quotes['DX-Y.NYB'];
  const dxyPrice = dxyQuote?.regularMarketPrice || 0;
  const dxyChange = dxyQuote?.regularMarketChangePercent || 0;

  const vvixQuote = quotes['^VVIX'];
  const vvixLevel = vvixQuote?.regularMarketPrice || null;

  const fomc = checkFOMC();

  // Breadth estimates from recent up/down days
  const recentSpyGains = spyCloses.slice(-20);
  const upDays20 = recentSpyGains.filter((c, i) => i > 0 && c > recentSpyGains[i - 1]).length;
  const pctAbove20d = Math.round((upDays20 / Math.max(recentSpyGains.length - 1, 1)) * 100);

  const recentSpy50 = spyCloses.slice(-50);
  const upDays50 = recentSpy50.filter((c, i) => i > 0 && c > recentSpy50[i - 1]).length;
  const pctAbove50d = Math.round((upDays50 / Math.max(recentSpy50.length - 1, 1)) * 100);

  const recentSpy200 = spyCloses.slice(-200);
  const upDays200 = recentSpy200.filter((c, i) => i > 0 && c > recentSpy200[i - 1]).length;
  const pctAbove200d = Math.round((upDays200 / Math.max(recentSpy200.length - 1, 1)) * 100);

  // Higher highs (momentum)
  const last20Highs = spyHighs.slice(-20);
  let higherHighCount = 0;
  for (let i = 1; i < last20Highs.length; i++) {
    if (last20Highs[i] > last20Highs[i - 1]) higherHighCount++;
  }
  const pctHigherHighs = last20Highs.length > 1
    ? Math.round((higherHighCount / (last20Highs.length - 1)) * 100)
    : 50;

  // Fed stance estimate
  let fedStance = 'neutral';
  if (tenYearYield > 4.5) fedStance = 'hawkish';
  else if (tenYearYield < 3.5) fedStance = 'dovish';

  // Execution window
  const last5Closes = spyCloses.slice(-5);
  const followThrough = last5Closes.length >= 2
    ? last5Closes.filter((c, i) => i > 0 && c > last5Closes[i - 1]).length / (last5Closes.length - 1)
    : 0.5;

  return {
    timestamp: new Date().toISOString(),
    volatility: {
      vix: vixCurrent,
      vixSlope,
      vixPercentile,
      vvix: vvixLevel,
      putCallEstimate
    },
    trend: {
      spy: {
        price: spyPrice,
        sma20: spySMA20,
        sma50: spySMA50,
        sma200: spySMA200,
        rsi: spyRSI,
        aboveSMA20: spyPrice > (spySMA20 || 0),
        aboveSMA50: spyPrice > (spySMA50 || 0),
        aboveSMA200: spyPrice > (spySMA200 || 0)
      },
      qqq: {
        price: qqqPrice,
        sma50: qqqSMA50,
        aboveSMA50: qqqPrice > (qqqSMA50 || 0)
      },
      regime
    },
    breadth: {
      pctAbove20d,
      pctAbove50d,
      pctAbove200d,
      advDeclineRatio: breadthRatio,
      sectorsPositive: sectorsAbove0,
      totalSectors: sectorList.length
    },
    momentum: {
      sectors: sectorList,
      topSectors,
      bottomSectors,
      sectorSpread,
      pctHigherHighs
    },
    macro: {
      tenYearYield,
      dxy: dxyPrice,
      dxyChange,
      fedStance,
      fomc
    },
    executionWindow: {
      followThroughRate: followThrough,
      breakoutsHolding: followThrough > 0.5,
      pullbacksBought: spyRSI ? (spyRSI > 40 && spyRSI < 70) : true,
      multiDayFollowThrough: followThrough > 0.6
    },
    quotes: {
      SPY: { price: quotes['SPY']?.regularMarketPrice, change: quotes['SPY']?.regularMarketChangePercent },
      QQQ: { price: quotes['QQQ']?.regularMarketPrice, change: quotes['QQQ']?.regularMarketChangePercent },
      VIX: { price: vixCurrent, change: quotes['^VIX']?.regularMarketChangePercent },
      DXY: { price: dxyPrice, change: dxyChange },
      TNX: { price: tenYearYield, change: tnxQuote?.regularMarketChangePercent }
    },
    spyIntraday: spyIntradayChart?.bars?.map(b => b.close).filter(Boolean) || []
  };
}
