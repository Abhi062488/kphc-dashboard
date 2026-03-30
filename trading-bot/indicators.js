/**
 * Technical Indicators Engine for Scalping
 * Implements RSI, EMA, VWAP, SuperTrend, Bollinger Bands, MACD, ATR
 */

class TechnicalIndicators {

  /**
   * Exponential Moving Average
   */
  static EMA(data, period) {
    if (data.length < period) return [];
    const k = 2 / (period + 1);
    const ema = [];

    // First EMA value is SMA
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += data[i];
    }
    ema.push(sum / period);

    // Calculate remaining EMA values
    for (let i = period; i < data.length; i++) {
      ema.push(data[i] * k + ema[ema.length - 1] * (1 - k));
    }

    return ema;
  }

  /**
   * Simple Moving Average
   */
  static SMA(data, period) {
    if (data.length < period) return [];
    const sma = [];
    for (let i = period - 1; i < data.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += data[j];
      }
      sma.push(sum / period);
    }
    return sma;
  }

  /**
   * Relative Strength Index (RSI)
   */
  static RSI(closes, period = 14) {
    if (closes.length < period + 1) return [];

    const gains = [];
    const losses = [];

    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? Math.abs(diff) : 0);
    }

    // First average gain/loss
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

    const rsi = [];
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - (100 / (1 + rs)));

    // Smoothed RSI
    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
    }

    return rsi;
  }

  /**
   * VWAP (Volume Weighted Average Price)
   */
  static VWAP(highs, lows, closes, volumes) {
    const vwap = [];
    let cumulativeTPV = 0;
    let cumulativeVolume = 0;

    for (let i = 0; i < closes.length; i++) {
      const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
      cumulativeTPV += typicalPrice * volumes[i];
      cumulativeVolume += volumes[i];
      vwap.push(cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : typicalPrice);
    }

    return vwap;
  }

  /**
   * Average True Range (ATR)
   */
  static ATR(highs, lows, closes, period = 14) {
    if (highs.length < period + 1) return [];

    const trueRanges = [];
    trueRanges.push(highs[0] - lows[0]);

    for (let i = 1; i < highs.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trueRanges.push(tr);
    }

    // First ATR is simple average
    let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const result = [atr];

    for (let i = period; i < trueRanges.length; i++) {
      atr = (atr * (period - 1) + trueRanges[i]) / period;
      result.push(atr);
    }

    return result;
  }

  /**
   * SuperTrend Indicator
   */
  static SuperTrend(highs, lows, closes, period = 10, multiplier = 3) {
    const atr = this.ATR(highs, lows, closes, period);
    if (atr.length === 0) return { trend: [], signal: [] };

    const superTrend = [];
    const signal = []; // 1 = bullish, -1 = bearish
    const offset = closes.length - atr.length;

    let prevUpperBand = 0, prevLowerBand = 0;
    let prevSuperTrend = 0;
    let prevSignal = 1;

    for (let i = 0; i < atr.length; i++) {
      const ci = i + offset;
      const hl2 = (highs[ci] + lows[ci]) / 2;

      let upperBand = hl2 + multiplier * atr[i];
      let lowerBand = hl2 - multiplier * atr[i];

      // Adjust bands
      if (i > 0) {
        upperBand = upperBand < prevUpperBand || closes[ci - 1] > prevUpperBand ? upperBand : prevUpperBand;
        lowerBand = lowerBand > prevLowerBand || closes[ci - 1] < prevLowerBand ? lowerBand : prevLowerBand;
      }

      let currentSignal;
      let currentSuperTrend;

      if (i === 0) {
        currentSignal = closes[ci] > upperBand ? 1 : -1;
      } else {
        if (prevSignal === 1) {
          currentSignal = closes[ci] < lowerBand ? -1 : 1;
        } else {
          currentSignal = closes[ci] > upperBand ? 1 : -1;
        }
      }

      currentSuperTrend = currentSignal === 1 ? lowerBand : upperBand;

      superTrend.push(currentSuperTrend);
      signal.push(currentSignal);

      prevUpperBand = upperBand;
      prevLowerBand = lowerBand;
      prevSuperTrend = currentSuperTrend;
      prevSignal = currentSignal;
    }

    return { trend: superTrend, signal };
  }

  /**
   * Bollinger Bands
   */
  static BollingerBands(closes, period = 20, stdDevMultiplier = 2) {
    if (closes.length < period) return { upper: [], middle: [], lower: [] };

    const middle = this.SMA(closes, period);
    const upper = [];
    const lower = [];

    for (let i = period - 1; i < closes.length; i++) {
      const slice = closes.slice(i - period + 1, i + 1);
      const mean = middle[i - period + 1];
      const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
      const stdDev = Math.sqrt(variance);

      upper.push(mean + stdDevMultiplier * stdDev);
      lower.push(mean - stdDevMultiplier * stdDev);
    }

    return { upper, middle, lower };
  }

  /**
   * MACD (Moving Average Convergence Divergence)
   */
  static MACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const fastEMA = this.EMA(closes, fastPeriod);
    const slowEMA = this.EMA(closes, slowPeriod);

    if (fastEMA.length === 0 || slowEMA.length === 0) return { macd: [], signal: [], histogram: [] };

    const offset = fastPeriod - slowPeriod; // negative
    const macdLine = [];

    for (let i = 0; i < slowEMA.length; i++) {
      const fastIdx = i + (slowPeriod - fastPeriod);
      if (fastIdx >= 0 && fastIdx < fastEMA.length) {
        macdLine.push(fastEMA[fastIdx] - slowEMA[i]);
      }
    }

    const signalLine = this.EMA(macdLine, signalPeriod);
    const histogram = [];

    const sigOffset = macdLine.length - signalLine.length;
    for (let i = 0; i < signalLine.length; i++) {
      histogram.push(macdLine[i + sigOffset] - signalLine[i]);
    }

    return {
      macd: macdLine,
      signal: signalLine,
      histogram,
    };
  }

  /**
   * Pivot Points (for intraday support/resistance)
   */
  static PivotPoints(high, low, close) {
    const pivot = (high + low + close) / 3;
    return {
      pivot: Math.round(pivot * 100) / 100,
      r1: Math.round((2 * pivot - low) * 100) / 100,
      r2: Math.round((pivot + (high - low)) * 100) / 100,
      r3: Math.round((high + 2 * (pivot - low)) * 100) / 100,
      s1: Math.round((2 * pivot - high) * 100) / 100,
      s2: Math.round((pivot - (high - low)) * 100) / 100,
      s3: Math.round((low - 2 * (high - pivot)) * 100) / 100,
    };
  }

  /**
   * Stochastic RSI
   */
  static StochRSI(closes, rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3) {
    const rsi = this.RSI(closes, rsiPeriod);
    if (rsi.length < stochPeriod) return { k: [], d: [] };

    const stochRSI = [];
    for (let i = stochPeriod - 1; i < rsi.length; i++) {
      const slice = rsi.slice(i - stochPeriod + 1, i + 1);
      const min = Math.min(...slice);
      const max = Math.max(...slice);
      stochRSI.push(max === min ? 50 : ((rsi[i] - min) / (max - min)) * 100);
    }

    const k = this.SMA(stochRSI, kSmooth);
    const d = this.SMA(k, dSmooth);

    return { k, d };
  }
}

module.exports = TechnicalIndicators;
