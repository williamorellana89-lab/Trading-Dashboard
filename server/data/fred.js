// FRED (Federal Reserve Economic Data) API fetcher

const FRED_API_KEY = 'd19d6b3382aebf796ab14051bc0d632e';
const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

// Series we fetch and what they mean
const FRED_SERIES = {
  DGS10:        { name: '10-Year Treasury',     unit: '%',    category: 'rates' },
  DGS2:         { name: '2-Year Treasury',      unit: '%',    category: 'rates' },
  T10Y2Y:       { name: '10Y-2Y Spread',        unit: '%',    category: 'rates' },
  T10Y3M:       { name: '10Y-3M Spread',        unit: '%',    category: 'rates' },
  FEDFUNDS:     { name: 'Fed Funds Rate',        unit: '%',    category: 'rates' },
  VIXCLS:       { name: 'VIX (CBOE)',            unit: '',     category: 'volatility' },
  DTWEXBGS:     { name: 'Trade-Wtd Dollar',      unit: '',     category: 'currency' },
  BAMLH0A0HYM2: { name: 'HY Credit Spread',     unit: '%',    category: 'credit' },
  ICSA:         { name: 'Initial Claims',        unit: 'K',    category: 'labor' },
  UNRATE:       { name: 'Unemployment',          unit: '%',    category: 'labor' },
  CPIAUCSL:     { name: 'CPI (All Urban)',       unit: '',     category: 'inflation' },
  CPILFESL:     { name: 'Core CPI',              unit: '',     category: 'inflation' },
  MORTGAGE30US: { name: '30Y Mortgage Rate',     unit: '%',    category: 'rates' },
};

async function fetchFredSeries(seriesId, limit = 30) {
  const url = `${FRED_BASE}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=${limit}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`FRED ${seriesId}: HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const obs = (json.observations || [])
      .filter(o => o.value !== '.')
      .map(o => ({ date: o.date, value: parseFloat(o.value) }))
      .filter(o => !isNaN(o.value));
    return obs;
  } catch (e) {
    console.warn(`FRED ${seriesId} error:`, e.message);
    return null;
  }
}

function calcChange(observations) {
  if (!observations || observations.length < 2) return null;
  const current = observations[0].value;
  const previous = observations[1].value;
  return { absolute: current - previous, percent: previous ? ((current - previous) / previous) * 100 : 0 };
}

function calcYoYChange(observations) {
  if (!observations || observations.length < 13) return null;
  const current = observations[0].value;
  // observations[12] = 12 months ago (monthly data, sorted desc)
  const yearAgo = observations[12]?.value;
  if (!yearAgo) return null;
  return ((current - yearAgo) / yearAgo) * 100;
}

function classifyLevel(seriesId, value) {
  switch (seriesId) {
    case 'VIXCLS':
      if (value < 15) return { signal: 'low', color: 'green', label: 'Complacent' };
      if (value < 20) return { signal: 'normal', color: 'green', label: 'Normal' };
      if (value < 25) return { signal: 'elevated', color: 'amber', label: 'Elevated' };
      if (value < 30) return { signal: 'high', color: 'amber', label: 'High' };
      return { signal: 'extreme', color: 'red', label: 'Extreme Fear' };

    case 'T10Y2Y':
    case 'T10Y3M':
      if (value < -0.5) return { signal: 'inverted', color: 'red', label: 'Inverted (Recession Signal)' };
      if (value < 0) return { signal: 'flat', color: 'amber', label: 'Flat/Inverting' };
      if (value < 0.5) return { signal: 'narrow', color: 'amber', label: 'Narrow' };
      return { signal: 'normal', color: 'green', label: 'Normal' };

    case 'BAMLH0A0HYM2':
      if (value < 3) return { signal: 'tight', color: 'green', label: 'Risk-On' };
      if (value < 4) return { signal: 'normal', color: 'green', label: 'Normal' };
      if (value < 5) return { signal: 'widening', color: 'amber', label: 'Widening' };
      if (value < 7) return { signal: 'stress', color: 'red', label: 'Credit Stress' };
      return { signal: 'crisis', color: 'red', label: 'Crisis Level' };

    case 'UNRATE':
      if (value < 4) return { signal: 'strong', color: 'green', label: 'Strong' };
      if (value < 5) return { signal: 'moderate', color: 'green', label: 'Moderate' };
      if (value < 6) return { signal: 'weakening', color: 'amber', label: 'Weakening' };
      return { signal: 'weak', color: 'red', label: 'Weak' };

    case 'FEDFUNDS':
      if (value < 2) return { signal: 'accommodative', color: 'green', label: 'Accommodative' };
      if (value < 4) return { signal: 'neutral', color: 'amber', label: 'Neutral' };
      if (value < 5.5) return { signal: 'restrictive', color: 'red', label: 'Restrictive' };
      return { signal: 'very_restrictive', color: 'red', label: 'Very Restrictive' };

    case 'ICSA':
      if (value < 220) return { signal: 'strong', color: 'green', label: 'Very Strong' };
      if (value < 260) return { signal: 'healthy', color: 'green', label: 'Healthy' };
      if (value < 300) return { signal: 'moderate', color: 'amber', label: 'Moderate' };
      return { signal: 'weakening', color: 'red', label: 'Weakening' };

    default:
      return { signal: 'neutral', color: 'amber', label: '' };
  }
}

function direction(change) {
  if (!change) return 'stable';
  if (change.absolute > 0.01) return 'rising';
  if (change.absolute < -0.01) return 'falling';
  return 'stable';
}

export async function fetchFredData() {
  // Fetch all series in parallel
  const results = {};
  await Promise.all(
    Object.keys(FRED_SERIES).map(async (id) => {
      results[id] = await fetchFredSeries(id, 30);
    })
  );

  // Process each series
  const processed = {};
  for (const [id, meta] of Object.entries(FRED_SERIES)) {
    const obs = results[id];
    if (!obs || obs.length === 0) {
      processed[id] = { ...meta, id, value: null, date: null, change: null, classification: null, direction: 'unknown' };
      continue;
    }

    const current = obs[0];
    const change = calcChange(obs);
    const classification = classifyLevel(id, current.value);

    processed[id] = {
      ...meta,
      id,
      value: current.value,
      date: current.date,
      change,
      direction: direction(change),
      classification,
      // For CPI, include YoY
      ...(id === 'CPIAUCSL' || id === 'CPILFESL' ? { yoyChange: calcYoYChange(obs) } : {}),
      // Include recent history for sparklines
      history: obs.slice(0, 20).reverse().map(o => o.value)
    };
  }

  // Compute derived indicators
  const yieldCurve = {
    spread10y2y: processed.T10Y2Y?.value,
    spread10y3m: processed.T10Y3M?.value,
    inverted: (processed.T10Y2Y?.value ?? 0) < 0 || (processed.T10Y3M?.value ?? 0) < 0,
    recessionSignal: (processed.T10Y2Y?.value ?? 0) < -0.2 && (processed.T10Y3M?.value ?? 0) < -0.2
  };

  const creditConditions = {
    hySpread: processed.BAMLH0A0HYM2?.value,
    stressed: (processed.BAMLH0A0HYM2?.value ?? 0) > 5,
    direction: processed.BAMLH0A0HYM2?.direction
  };

  const fedPolicy = {
    rate: processed.FEDFUNDS?.value,
    stance: processed.FEDFUNDS?.classification?.signal || 'unknown'
  };

  return {
    series: processed,
    derived: { yieldCurve, creditConditions, fedPolicy },
    fetchedAt: new Date().toISOString()
  };
}
