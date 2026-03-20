// Scoring Engine — all formulas editable here

const WEIGHTS = {
  volatility: 0.25,
  momentum: 0.25,
  trend: 0.20,
  breadth: 0.20,
  macro: 0.10
};

function clamp(val, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(val)));
}

function scoreVolatility(data) {
  const { vix, vixSlope, vixPercentile, putCallEstimate } = data.volatility;

  // Lower VIX = better for swing trading
  let vixScore;
  if (vix < 13) vixScore = 95;
  else if (vix < 16) vixScore = 85;
  else if (vix < 20) vixScore = 70;
  else if (vix < 25) vixScore = 50;
  else if (vix < 30) vixScore = 30;
  else if (vix < 35) vixScore = 15;
  else vixScore = 5;

  // Falling VIX is good
  const slopeScore = vixSlope < -0.5 ? 90 : vixSlope < 0 ? 70 : vixSlope < 0.5 ? 50 : vixSlope < 1 ? 30 : 10;

  // Lower percentile = low vol regime = good
  const percentileScore = clamp(100 - vixPercentile);

  // Put/call ratio: moderate is healthy
  let pcScore;
  if (putCallEstimate < 0.7) pcScore = 60; // complacent
  else if (putCallEstimate < 1.0) pcScore = 85; // healthy
  else if (putCallEstimate < 1.2) pcScore = 50; // cautious
  else pcScore = 25; // fearful

  const score = vixScore * 0.4 + slopeScore * 0.2 + percentileScore * 0.2 + pcScore * 0.2;

  let interpretation;
  if (score >= 70) interpretation = 'low-risk';
  else if (score >= 50) interpretation = 'moderate';
  else interpretation = 'elevated-risk';

  const direction = vixSlope < -0.2 ? 'falling' : vixSlope > 0.2 ? 'rising' : 'stable';

  return { score: clamp(score), interpretation, direction, components: { vixScore, slopeScore, percentileScore, pcScore } };
}

function scoreTrend(data) {
  const { spy, qqq, regime } = data.trend;

  // Price vs MAs
  const maScore = [spy.aboveSMA20, spy.aboveSMA50, spy.aboveSMA200, qqq.aboveSMA50]
    .filter(Boolean).length * 25;

  // RSI scoring (40-60 is neutral, above 50 is bullish momentum)
  let rsiScore;
  if (spy.rsi >= 50 && spy.rsi <= 70) rsiScore = 85;
  else if (spy.rsi > 70) rsiScore = 50; // overbought
  else if (spy.rsi >= 40) rsiScore = 60;
  else if (spy.rsi >= 30) rsiScore = 30;
  else rsiScore = 15; // oversold

  // Regime
  const regimeScore = regime === 'uptrend' ? 90 : regime === 'chop' ? 45 : 15;

  const score = maScore * 0.4 + rsiScore * 0.3 + regimeScore * 0.3;

  let interpretation;
  if (score >= 70) interpretation = 'healthy';
  else if (score >= 50) interpretation = 'mixed';
  else interpretation = 'weakening';

  const direction = regime === 'uptrend' ? 'bullish' : regime === 'downtrend' ? 'bearish' : 'sideways';

  return { score: clamp(score), interpretation, direction, regime, components: { maScore, rsiScore, regimeScore } };
}

function scoreBreadth(data) {
  const { pctAbove20d, pctAbove50d, pctAbove200d, advDeclineRatio, sectorsPositive, totalSectors } = data.breadth;

  // Normalize breadth metrics
  const above20Score = clamp(pctAbove20d * 1.5); // scale up since our proxy is conservative
  const above50Score = clamp(pctAbove50d * 1.5);
  const above200Score = clamp(pctAbove200d * 1.2);

  // A/D ratio
  const adScore = clamp(advDeclineRatio * 100);

  // Sector participation
  const sectorScore = clamp((sectorsPositive / Math.max(totalSectors, 1)) * 100);

  const score = above20Score * 0.2 + above50Score * 0.2 + above200Score * 0.2 + adScore * 0.2 + sectorScore * 0.2;

  let interpretation;
  if (score >= 65) interpretation = 'expanding';
  else if (score >= 45) interpretation = 'neutral';
  else interpretation = 'contracting';

  const direction = adScore > 55 ? 'improving' : adScore < 45 ? 'deteriorating' : 'stable';

  return { score: clamp(score), interpretation, direction, components: { above20Score, above50Score, above200Score, adScore, sectorScore } };
}

function scoreMomentum(data) {
  const { sectorSpread, pctHigherHighs, topSectors, bottomSectors } = data.momentum;

  // Sector spread: wider = better leadership
  let spreadScore;
  if (sectorSpread > 3) spreadScore = 90;
  else if (sectorSpread > 1.5) spreadScore = 75;
  else if (sectorSpread > 0.5) spreadScore = 60;
  else if (sectorSpread > 0) spreadScore = 45;
  else spreadScore = 20;

  // Higher highs percentage
  const hhScore = clamp(pctHigherHighs * 1.3);

  // Leadership quality: offensive sectors leading = better
  const offensiveSectors = ['XLK', 'XLY', 'XLI', 'XLF', 'XLC'];
  const topOffensive = topSectors.filter(s => offensiveSectors.includes(s.symbol)).length;
  const leadershipScore = topOffensive >= 2 ? 85 : topOffensive >= 1 ? 65 : 35;

  const score = spreadScore * 0.35 + hhScore * 0.35 + leadershipScore * 0.3;

  let interpretation;
  if (score >= 70) interpretation = 'strong';
  else if (score >= 50) interpretation = 'moderate';
  else interpretation = 'weak';

  const direction = sectorSpread > 1 ? 'broad' : sectorSpread > 0 ? 'narrow' : 'defensive';

  return { score: clamp(score), interpretation, direction, components: { spreadScore, hhScore, leadershipScore } };
}

function scoreMacro(data, fredData) {
  const { tenYearYield, dxyChange, fedStance, fomc } = data.macro;

  // Yield: moderate is okay, very high or spiking is bad
  let yieldScore;
  if (tenYearYield < 3.5) yieldScore = 80;
  else if (tenYearYield < 4.0) yieldScore = 70;
  else if (tenYearYield < 4.5) yieldScore = 55;
  else if (tenYearYield < 5.0) yieldScore = 35;
  else yieldScore = 15;

  // DXY: stable or falling is good for equities
  let dxyScore;
  if (dxyChange < -0.5) dxyScore = 80;
  else if (dxyChange < 0) dxyScore = 70;
  else if (dxyChange < 0.3) dxyScore = 55;
  else if (dxyChange < 0.7) dxyScore = 40;
  else dxyScore = 20;

  // Fed stance — use real FRED data if available
  let fedScore;
  if (fredData?.derived?.fedPolicy) {
    const stance = fredData.derived.fedPolicy.stance;
    fedScore = stance === 'accommodative' ? 85 : stance === 'neutral' ? 60 : stance === 'restrictive' ? 30 : 15;
  } else {
    fedScore = fedStance === 'dovish' ? 85 : fedStance === 'neutral' ? 60 : 30;
  }

  // Yield curve score from FRED (inverted = recession risk = bad for equities)
  let yieldCurveScore = 60; // default neutral
  if (fredData?.derived?.yieldCurve) {
    const yc = fredData.derived.yieldCurve;
    if (yc.recessionSignal) yieldCurveScore = 10;
    else if (yc.inverted) yieldCurveScore = 25;
    else if ((yc.spread10y2y ?? 1) < 0.3) yieldCurveScore = 45;
    else yieldCurveScore = 80;
  }

  // Credit conditions from FRED (wide spreads = stress = bad)
  let creditScore = 60; // default neutral
  if (fredData?.derived?.creditConditions) {
    const cc = fredData.derived.creditConditions;
    const spread = cc.hySpread ?? 4;
    if (spread < 3) creditScore = 85;
    else if (spread < 4) creditScore = 70;
    else if (spread < 5) creditScore = 50;
    else if (spread < 7) creditScore = 25;
    else creditScore = 10;
  }

  // FOMC proximity penalty
  const fomcPenalty = fomc.imminent ? (fomc.isToday ? 30 : 15) : 0;

  // Enhanced weighting when FRED data is available
  let rawScore;
  if (fredData) {
    rawScore = yieldScore * 0.20 + dxyScore * 0.15 + fedScore * 0.25 + yieldCurveScore * 0.20 + creditScore * 0.20;
  } else {
    rawScore = yieldScore * 0.35 + dxyScore * 0.25 + fedScore * 0.40;
  }
  const score = clamp(rawScore - fomcPenalty);

  let interpretation;
  if (score >= 65) interpretation = 'supportive';
  else if (score >= 45) interpretation = 'neutral';
  else interpretation = 'headwind';

  const direction = dxyChange < 0 ? 'easing' : dxyChange > 0.3 ? 'tightening' : 'stable';

  return { score: clamp(score), interpretation, direction, fomcAlert: fomc, components: { yieldScore, dxyScore, fedScore, yieldCurveScore, creditScore, fomcPenalty } };
}

function scoreExecutionWindow(data) {
  const { followThroughRate, breakoutsHolding, pullbacksBought, multiDayFollowThrough } = data.executionWindow;

  let score = 50; // baseline
  if (breakoutsHolding) score += 15;
  if (pullbacksBought) score += 15;
  if (multiDayFollowThrough) score += 15;
  score += (followThroughRate - 0.5) * 40; // -20 to +20

  const bonuses = [breakoutsHolding, pullbacksBought, multiDayFollowThrough].filter(Boolean).length;
  if (bonuses === 3) score += 5;

  return {
    score: clamp(score),
    breakoutsHolding,
    pullbacksBought,
    multiDayFollowThrough,
    followThroughRate: Math.round(followThroughRate * 100)
  };
}

function generateDecision(marketQuality, executionWindow, categoryScores) {
  let decision, advice;

  if (marketQuality >= 80) {
    decision = 'YES';
    advice = 'Full position sizing, press risk on A+ setups.';
  } else if (marketQuality >= 60) {
    decision = 'CAUTION';
    advice = 'Half size, A+ setups only. Be selective.';
  } else {
    decision = 'NO';
    advice = 'Avoid trading. Preserve capital.';
  }

  // Execution window can downgrade
  if (executionWindow.score < 40 && decision === 'YES') {
    decision = 'CAUTION';
    advice = 'Market is healthy but setups are not following through. Reduce size.';
  }

  return { decision, advice };
}

function generateSummary(scores, data) {
  const parts = [];

  // Regime
  const regime = data.trend.regime;
  if (regime === 'uptrend') parts.push('Strong trend environment');
  else if (regime === 'chop') parts.push('Choppy, range-bound market');
  else parts.push('Downtrend — risk-off environment');

  // Breadth
  if (scores.breadth.interpretation === 'expanding') parts.push('with expanding breadth');
  else if (scores.breadth.interpretation === 'contracting') parts.push('with narrowing participation');

  // Volatility
  if (scores.volatility.interpretation === 'low-risk') parts.push('and low volatility');
  else if (scores.volatility.interpretation === 'elevated-risk') parts.push('amid elevated volatility');

  // Sector leadership
  const leaders = data.momentum.topSectors.slice(0, 2).map(s => s.name).join(' and ');
  if (leaders) parts.push(`Sector leadership in ${leaders}`);

  // Macro
  if (scores.macro.fomcAlert.imminent) {
    parts.push(`FOMC meeting ${scores.macro.fomcAlert.isToday ? 'TODAY' : `in ${scores.macro.fomcAlert.hoursUntil}h`} — expect volatility`);
  }

  // Advice
  const { decision } = generateDecision(scores.marketQuality, scores.executionWindow, scores);
  if (decision === 'YES') parts.push('Favor selective swing trades with disciplined risk.');
  else if (decision === 'CAUTION') parts.push('Be highly selective, reduce position sizes.');
  else parts.push('Sit on hands. Wait for better conditions.');

  return parts.join('. ') + '.';
}

export function computeScores(data, mode = 'swing', fredData = null) {
  const volatility = scoreVolatility(data);
  const trend = scoreTrend(data);
  const breadth = scoreBreadth(data);
  const momentum = scoreMomentum(data);
  const macro = scoreMacro(data, fredData);
  const executionWindow = scoreExecutionWindow(data);

  // Mode adjustments
  const modeMultiplier = mode === 'day' ? { volatility: 1.1, momentum: 1.1, trend: 0.9, breadth: 0.9, macro: 1.0 } :
    { volatility: 1.0, momentum: 1.0, trend: 1.0, breadth: 1.0, macro: 1.0 };

  const marketQuality = clamp(
    volatility.score * WEIGHTS.volatility * modeMultiplier.volatility +
    momentum.score * WEIGHTS.momentum * modeMultiplier.momentum +
    trend.score * WEIGHTS.trend * modeMultiplier.trend +
    breadth.score * WEIGHTS.breadth * modeMultiplier.breadth +
    macro.score * WEIGHTS.macro * modeMultiplier.macro
  );

  const scores = { volatility, trend, breadth, momentum, macro, executionWindow, marketQuality };
  const { decision, advice } = generateDecision(marketQuality, executionWindow, scores);
  const summary = generateSummary(scores, data);

  return {
    decision,
    advice,
    marketQuality,
    executionWindow,
    categories: { volatility, trend, breadth, momentum, macro },
    summary,
    weights: WEIGHTS,
    mode
  };
}
