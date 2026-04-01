/**
 * Scalping Bot Engine
 * Generates trading signals for NIFTY50 and SENSEX options scalping
 * Uses OI analysis, IV analysis, PCR, technical indicators, and price action
 */

const MarketDataFetcher = require('./market-data');
const TechnicalIndicators = require('./indicators');
const DhanAPI = require('./dhan-api');

class ScalpingBotEngine {
  constructor() {
    this.marketData = new MarketDataFetcher();
    this.dhan = new DhanAPI();
    this.useDhan = false; // Will be set to true if Dhan is connected
    this.priceHistory = { NIFTY: [], BANKNIFTY: [] };
    this.signals = [];
    this.activePositions = [];
    this.pnl = { realized: 0, unrealized: 0, trades: [] };
    this.config = {
      // Scalping parameters
      maxRiskPerTrade: 2000,       // Max risk per trade in INR
      targetMultiplier: 1.5,       // Risk:Reward = 1:1.5
      trailingStopPercent: 30,     // 30% trailing stop on premium
      maxOpenPositions: 2,         // Max simultaneous positions
      lotSize: { NIFTY: 25, BANKNIFTY: 15 },

      // Signal thresholds
      rsiOverbought: 70,
      rsiOversold: 30,
      pcrBullish: 1.2,            // PCR > 1.2 = bullish
      pcrBearish: 0.7,            // PCR < 0.7 = bearish
      minOIChangePercent: 5,       // Min 5% OI change for significance
      minIVPercentile: 20,         // Min IV percentile for entry
      maxIVPercentile: 80,         // Max IV percentile (avoid IV crush)
    };
    this.running = false;
    this.interval = null;
    this.listeners = [];
  }

  /**
   * Initialize the bot engine
   */
  async initialize() {
    console.log('[Bot] Initializing scalping engine...');

    // Try Dhan API first
    if (this.dhan.accessToken && this.dhan.clientId) {
      const status = await this.dhan.isConnected();
      if (status.connected) {
        this.useDhan = true;
        console.log('[Bot] Connected to Dhan API - LIVE DATA mode');
        return true;
      }
      console.log('[Bot] Dhan API connection failed:', status.reason);
    }

    // Fallback to NSE scraper
    const sessionOk = await this.marketData.initSession();
    if (!sessionOk) {
      console.log('[Bot] Warning: Could not establish NSE session. Will use demo mode.');
    }
    return true;
  }

  /**
   * Configure Dhan API credentials
   */
  setDhanCredentials(accessToken, clientId) {
    this.dhan = new DhanAPI(accessToken, clientId);
    console.log('[Bot] Dhan credentials updated');
  }

  /**
   * Start the bot - fetch data every 3 seconds
   */
  start() {
    if (this.running) return;
    this.running = true;
    console.log('[Bot] Scalping bot started');

    this.tick(); // Initial tick
    this.interval = setInterval(() => this.tick(), 5000); // Every 5 seconds
  }

  /**
   * Stop the bot
   */
  stop() {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('[Bot] Scalping bot stopped');
  }

  /**
   * Main tick - fetch data and generate signals
   */
  async tick() {
    try {
      const analysis = {};

      if (this.useDhan) {
        // Use Dhan API for live data
        const [niftyRaw, bankNiftyRaw] = await Promise.all([
          this.dhan.getOptionChain('NIFTY'),
          this.dhan.getOptionChain('BANKNIFTY'),
        ]);

        if (niftyRaw) {
          const parsed = this.dhan.parseOptionChain(niftyRaw, 'NIFTY');
          if (parsed) {
            const sr = this.marketData.findSupportResistance(parsed);
            analysis.nifty = this.analyzeForScalping('NIFTY', parsed, sr);
          }
        }

        if (bankNiftyRaw) {
          const parsed = this.dhan.parseOptionChain(bankNiftyRaw, 'BANKNIFTY');
          if (parsed) {
            const sr = this.marketData.findSupportResistance(parsed);
            analysis.bankNifty = this.analyzeForScalping('BANKNIFTY', parsed, sr);
          }
        }
      } else {
        // Fallback to NSE scraper
        const [niftyChain, bankNiftyChain, indices] = await Promise.all([
          this.marketData.getNiftyOptionsChain(),
          this.marketData.getBankNiftyOptionsChain(),
          this.marketData.getMarketIndices(),
        ]);

        if (niftyChain) {
          const parsed = this.marketData.parseOptionsChain(niftyChain);
          if (parsed) {
            const sr = this.marketData.findSupportResistance(parsed);
            analysis.nifty = this.analyzeForScalping('NIFTY', parsed, sr);
          }
        }

        if (bankNiftyChain) {
          const parsed = this.marketData.parseOptionsChain(bankNiftyChain);
          if (parsed) {
            const sr = this.marketData.findSupportResistance(parsed);
            analysis.bankNifty = this.analyzeForScalping('BANKNIFTY', parsed, sr);
          }
        }
      }

      // Update active positions
      this.updatePositions(analysis);

      // Notify listeners
      this.emit('update', {
        analysis,
        signals: this.signals.slice(-20),
        positions: this.activePositions,
        pnl: this.pnl,
        timestamp: new Date().toISOString(),
      });

    } catch (err) {
      console.error('[Bot] Tick error:', err.message);
    }
  }

  /**
   * Core scalping analysis for an index
   */
  analyzeForScalping(symbol, parsedChain, supportResistance) {
    const spot = parsedChain.underlyingValue;
    const pcr = parseFloat(parsedChain.pcr);
    const data = parsedChain.data;

    // Find ATM strike (nearest to spot)
    const strikes = data.map(d => d.strikePrice);
    const atmStrike = strikes.reduce((prev, curr) =>
      Math.abs(curr - spot) < Math.abs(prev - spot) ? curr : prev
    );

    // Get ATM and nearby strikes data
    const atmIndex = data.findIndex(d => d.strikePrice === atmStrike);
    const nearbyData = data.slice(Math.max(0, atmIndex - 5), atmIndex + 6);

    // IV Analysis
    const atmData = data.find(d => d.strikePrice === atmStrike);
    const atmIV = {
      call: atmData?.CE?.iv || 0,
      put: atmData?.PE?.iv || 0,
      avg: ((atmData?.CE?.iv || 0) + (atmData?.PE?.iv || 0)) / 2,
    };

    // OI Analysis
    const oiAnalysis = this.analyzeOI(data, spot, atmStrike);

    // Momentum detection
    const momentum = this.detectMomentum(parsedChain, supportResistance);

    // Generate scalping signals
    const signals = this.generateScalpingSignals(
      symbol, spot, atmStrike, pcr, atmIV, oiAnalysis, momentum, supportResistance, nearbyData
    );

    // Market sentiment
    const sentiment = this.determineSentiment(pcr, oiAnalysis, momentum);

    return {
      symbol,
      spot,
      atmStrike,
      pcr,
      atmIV,
      oiAnalysis,
      momentum,
      supportResistance,
      signals,
      sentiment,
      nearbyStrikes: nearbyData.map(d => ({
        strike: d.strikePrice,
        ceOI: d.CE?.oi || 0,
        ceLTP: d.CE?.ltp || 0,
        ceIV: d.CE?.iv || 0,
        ceOIChange: d.CE?.oiChange || 0,
        peOI: d.PE?.oi || 0,
        peLTP: d.PE?.ltp || 0,
        peIV: d.PE?.iv || 0,
        peOIChange: d.PE?.oiChange || 0,
      })),
      timestamp: parsedChain.timestamp,
    };
  }

  /**
   * Analyze Open Interest patterns
   */
  analyzeOI(data, spot, atmStrike) {
    let callOIAboveATM = 0, putOIBelowATM = 0;
    let callOIBuildUp = 0, putOIBuildUp = 0;
    let callUnwinding = 0, putUnwinding = 0;

    data.forEach(item => {
      if (item.strikePrice >= atmStrike && item.CE) {
        callOIAboveATM += item.CE.oi;
        if (item.CE.oiChange > 0) callOIBuildUp += item.CE.oiChange;
        if (item.CE.oiChange < 0) callUnwinding += Math.abs(item.CE.oiChange);
      }
      if (item.strikePrice <= atmStrike && item.PE) {
        putOIBelowATM += item.PE.oi;
        if (item.PE.oiChange > 0) putOIBuildUp += item.PE.oiChange;
        if (item.PE.oiChange < 0) putUnwinding += Math.abs(item.PE.oiChange);
      }
    });

    // Determine OI-based direction
    let direction = 'NEUTRAL';
    if (putOIBuildUp > callOIBuildUp * 1.3) direction = 'BULLISH'; // Put writers are confident
    if (callOIBuildUp > putOIBuildUp * 1.3) direction = 'BEARISH'; // Call writers are confident
    if (callUnwinding > callOIBuildUp && putOIBuildUp > putUnwinding) direction = 'BULLISH'; // Short covering + put writing
    if (putUnwinding > putOIBuildUp && callOIBuildUp > callUnwinding) direction = 'BEARISH'; // Put unwinding + call writing

    return {
      callOIAboveATM,
      putOIBelowATM,
      callOIBuildUp,
      putOIBuildUp,
      callUnwinding,
      putUnwinding,
      direction,
      strength: Math.abs(putOIBuildUp - callOIBuildUp) / Math.max(putOIBuildUp, callOIBuildUp, 1) * 100,
    };
  }

  /**
   * Detect momentum from price relative to support/resistance
   */
  detectMomentum(parsedChain, sr) {
    if (!sr) return { direction: 'NEUTRAL', strength: 0 };

    const spot = sr.spot;
    const range = sr.range;

    // Where is spot in the range?
    const rangePosition = range.width > 0
      ? ((spot - range.lower) / range.width) * 100
      : 50;

    let direction = 'NEUTRAL';
    let strength = 0;

    if (rangePosition > 70) {
      direction = 'BEARISH'; // Near resistance
      strength = rangePosition;
    } else if (rangePosition < 30) {
      direction = 'BULLISH'; // Near support
      strength = 100 - rangePosition;
    } else {
      direction = 'NEUTRAL';
      strength = 50;
    }

    return { direction, strength, rangePosition };
  }

  /**
   * Generate scalping signals
   */
  generateScalpingSignals(symbol, spot, atmStrike, pcr, atmIV, oiAnalysis, momentum, sr, nearbyData) {
    const signals = [];
    const lotSize = this.config.lotSize[symbol] || 25;
    const now = new Date();

    // Check market hours (9:15 AM to 3:30 PM IST)
    const istHour = (now.getUTCHours() + 5) % 24 + (now.getUTCMinutes() + 30 >= 60 ? 1 : 0);
    const istMin = (now.getUTCMinutes() + 30) % 60;

    // SIGNAL 1: PCR-based signal
    if (pcr >= this.config.pcrBullish && oiAnalysis.direction !== 'BEARISH') {
      const ceStrike = atmStrike; // Buy ATM CE
      const ceData = nearbyData.find(d => d.strikePrice === ceStrike);
      if (ceData && ceData.CE) {
        const entry = ceData.CE.ltp;
        const sl = Math.max(entry * 0.7, entry - (this.config.maxRiskPerTrade / lotSize));
        const target = entry + (entry - sl) * this.config.targetMultiplier;

        signals.push({
          id: `${symbol}-PCR-BULL-${Date.now()}`,
          type: 'BUY',
          instrument: `${symbol} ${ceStrike} CE`,
          symbol,
          strike: ceStrike,
          optionType: 'CE',
          entry: Math.round(entry * 100) / 100,
          stopLoss: Math.round(sl * 100) / 100,
          target: Math.round(target * 100) / 100,
          lotSize,
          riskReward: this.config.targetMultiplier.toFixed(1),
          reason: `PCR ${pcr} indicates strong put writing (bullish). OI direction: ${oiAnalysis.direction}`,
          confidence: pcr >= 1.5 ? 'HIGH' : 'MEDIUM',
          strategy: 'PCR_BULLISH',
          timestamp: now.toISOString(),
        });
      }
    }

    if (pcr <= this.config.pcrBearish && oiAnalysis.direction !== 'BULLISH') {
      const peStrike = atmStrike; // Buy ATM PE
      const peData = nearbyData.find(d => d.strikePrice === peStrike);
      if (peData && peData.PE) {
        const entry = peData.PE.ltp;
        const sl = Math.max(entry * 0.7, entry - (this.config.maxRiskPerTrade / lotSize));
        const target = entry + (entry - sl) * this.config.targetMultiplier;

        signals.push({
          id: `${symbol}-PCR-BEAR-${Date.now()}`,
          type: 'BUY',
          instrument: `${symbol} ${peStrike} PE`,
          symbol,
          strike: peStrike,
          optionType: 'PE',
          entry: Math.round(entry * 100) / 100,
          stopLoss: Math.round(sl * 100) / 100,
          target: Math.round(target * 100) / 100,
          lotSize,
          riskReward: this.config.targetMultiplier.toFixed(1),
          reason: `PCR ${pcr} indicates call writing dominance (bearish). OI direction: ${oiAnalysis.direction}`,
          confidence: pcr <= 0.5 ? 'HIGH' : 'MEDIUM',
          strategy: 'PCR_BEARISH',
          timestamp: now.toISOString(),
        });
      }
    }

    // SIGNAL 2: OI Buildup + Momentum Confluence
    if (oiAnalysis.direction === 'BULLISH' && oiAnalysis.strength > 30) {
      if (sr && spot < sr.resistance.primary) {
        const ceStrike = atmStrike;
        const ceData = nearbyData.find(d => d.strikePrice === ceStrike);
        if (ceData && ceData.CE && ceData.CE.ltp > 0) {
          const entry = ceData.CE.ltp;
          const sl = entry * 0.7;
          const target = entry * 1.5;

          signals.push({
            id: `${symbol}-OI-BULL-${Date.now()}`,
            type: 'BUY',
            instrument: `${symbol} ${ceStrike} CE`,
            symbol,
            strike: ceStrike,
            optionType: 'CE',
            entry: Math.round(entry * 100) / 100,
            stopLoss: Math.round(sl * 100) / 100,
            target: Math.round(target * 100) / 100,
            lotSize,
            riskReward: '1.7',
            reason: `Strong put OI buildup (${oiAnalysis.putOIBuildUp.toLocaleString()}) vs call OI (${oiAnalysis.callOIBuildUp.toLocaleString()}). Support at ${sr.support.primary}`,
            confidence: oiAnalysis.strength > 50 ? 'HIGH' : 'MEDIUM',
            strategy: 'OI_BUILDUP_BULL',
            timestamp: now.toISOString(),
          });
        }
      }
    }

    if (oiAnalysis.direction === 'BEARISH' && oiAnalysis.strength > 30) {
      if (sr && spot > sr.support.primary) {
        const peStrike = atmStrike;
        const peData = nearbyData.find(d => d.strikePrice === peStrike);
        if (peData && peData.PE && peData.PE.ltp > 0) {
          const entry = peData.PE.ltp;
          const sl = entry * 0.7;
          const target = entry * 1.5;

          signals.push({
            id: `${symbol}-OI-BEAR-${Date.now()}`,
            type: 'BUY',
            instrument: `${symbol} ${peStrike} PE`,
            symbol,
            strike: peStrike,
            optionType: 'PE',
            entry: Math.round(entry * 100) / 100,
            stopLoss: Math.round(sl * 100) / 100,
            target: Math.round(target * 100) / 100,
            lotSize,
            riskReward: '1.7',
            reason: `Strong call OI buildup (${oiAnalysis.callOIBuildUp.toLocaleString()}) indicates resistance. Resistance at ${sr.resistance.primary}`,
            confidence: oiAnalysis.strength > 50 ? 'HIGH' : 'MEDIUM',
            strategy: 'OI_BUILDUP_BEAR',
            timestamp: now.toISOString(),
          });
        }
      }
    }

    // SIGNAL 3: IV Skew opportunity (for mean reversion)
    if (atmIV.avg > 0) {
      const ivSkew = Math.abs(atmIV.call - atmIV.put);
      if (ivSkew > 3) { // Significant skew
        const isCallIVHigher = atmIV.call > atmIV.put;
        signals.push({
          id: `${symbol}-IV-SKEW-${Date.now()}`,
          type: 'INFO',
          instrument: `${symbol} ATM`,
          symbol,
          strike: atmStrike,
          optionType: isCallIVHigher ? 'CE' : 'PE',
          entry: 0,
          stopLoss: 0,
          target: 0,
          lotSize,
          riskReward: 'N/A',
          reason: `IV Skew Alert: CE IV=${atmIV.call.toFixed(1)}% vs PE IV=${atmIV.put.toFixed(1)}%. ${isCallIVHigher ? 'Call' : 'Put'} IV elevated - potential mean reversion opportunity`,
          confidence: 'LOW',
          strategy: 'IV_SKEW',
          timestamp: now.toISOString(),
        });
      }
    }

    // SIGNAL 4: Range breakout signal
    if (sr && sr.range.width > 0) {
      const distToResistance = sr.resistance.primary - spot;
      const distToSupport = spot - sr.support.primary;
      const totalRange = sr.range.width;

      if (distToResistance / totalRange < 0.05 && distToResistance > 0) {
        signals.push({
          id: `${symbol}-BREAKOUT-UP-${Date.now()}`,
          type: 'ALERT',
          instrument: `${symbol}`,
          symbol,
          strike: sr.resistance.primary,
          optionType: 'CE',
          entry: 0,
          stopLoss: 0,
          target: 0,
          lotSize,
          riskReward: 'N/A',
          reason: `Approaching resistance ${sr.resistance.primary} (${distToResistance.toFixed(0)} pts away). Watch for breakout or rejection. Max Call OI: ${sr.resistance.primaryOI.toLocaleString()}`,
          confidence: 'MEDIUM',
          strategy: 'BREAKOUT_WATCH',
          timestamp: now.toISOString(),
        });
      }

      if (distToSupport / totalRange < 0.05 && distToSupport > 0) {
        signals.push({
          id: `${symbol}-BREAKOUT-DN-${Date.now()}`,
          type: 'ALERT',
          instrument: `${symbol}`,
          symbol,
          strike: sr.support.primary,
          optionType: 'PE',
          entry: 0,
          stopLoss: 0,
          target: 0,
          lotSize,
          riskReward: 'N/A',
          reason: `Approaching support ${sr.support.primary} (${distToSupport.toFixed(0)} pts away). Watch for bounce or breakdown. Max Put OI: ${sr.support.primaryOI.toLocaleString()}`,
          confidence: 'MEDIUM',
          strategy: 'BREAKOUT_WATCH',
          timestamp: now.toISOString(),
        });
      }
    }

    // Store signals
    if (signals.length > 0) {
      this.signals.push(...signals);
      // Keep last 100 signals
      if (this.signals.length > 100) {
        this.signals = this.signals.slice(-100);
      }
    }

    return signals;
  }

  /**
   * Determine overall market sentiment
   */
  determineSentiment(pcr, oiAnalysis, momentum) {
    let score = 0; // -100 to +100

    // PCR contribution (weight: 30%)
    if (pcr > 1.2) score += 30;
    else if (pcr > 1.0) score += 15;
    else if (pcr < 0.7) score -= 30;
    else if (pcr < 0.9) score -= 15;

    // OI Analysis contribution (weight: 40%)
    if (oiAnalysis.direction === 'BULLISH') score += 40 * (oiAnalysis.strength / 100);
    if (oiAnalysis.direction === 'BEARISH') score -= 40 * (oiAnalysis.strength / 100);

    // Momentum contribution (weight: 30%)
    if (momentum.direction === 'BULLISH') score += 30 * (momentum.strength / 100);
    if (momentum.direction === 'BEARISH') score -= 30 * (momentum.strength / 100);

    let label = 'NEUTRAL';
    if (score > 40) label = 'STRONGLY BULLISH';
    else if (score > 15) label = 'BULLISH';
    else if (score < -40) label = 'STRONGLY BEARISH';
    else if (score < -15) label = 'BEARISH';

    return { score: Math.round(score), label };
  }

  /**
   * Track a position
   */
  addPosition(signal) {
    const position = {
      id: signal.id,
      instrument: signal.instrument,
      symbol: signal.symbol,
      strike: signal.strike,
      optionType: signal.optionType,
      entryPrice: signal.entry,
      currentPrice: signal.entry,
      stopLoss: signal.stopLoss,
      target: signal.target,
      lotSize: signal.lotSize,
      lots: 1,
      pnl: 0,
      pnlPercent: 0,
      status: 'ACTIVE',
      entryTime: new Date().toISOString(),
      trailingStop: signal.stopLoss,
      highWaterMark: signal.entry,
    };
    this.activePositions.push(position);
    return position;
  }

  /**
   * Update active positions with latest prices
   */
  updatePositions(analysis) {
    this.activePositions.forEach(pos => {
      if (pos.status !== 'ACTIVE') return;

      // Find current price from analysis
      let currentPrice = pos.currentPrice;
      const data = pos.symbol === 'NIFTY' ? analysis.nifty : analysis.bankNifty;

      if (data && data.nearbyStrikes) {
        const strikeData = data.nearbyStrikes.find(s => s.strike === pos.strike);
        if (strikeData) {
          currentPrice = pos.optionType === 'CE' ? strikeData.ceLTP : strikeData.peLTP;
        }
      }

      pos.currentPrice = currentPrice;
      pos.pnl = (currentPrice - pos.entryPrice) * pos.lotSize * pos.lots;
      pos.pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;

      // Update trailing stop
      if (currentPrice > pos.highWaterMark) {
        pos.highWaterMark = currentPrice;
        const newTrailingStop = currentPrice * (1 - this.config.trailingStopPercent / 100);
        if (newTrailingStop > pos.trailingStop) {
          pos.trailingStop = Math.round(newTrailingStop * 100) / 100;
        }
      }

      // Check stop loss / target
      if (currentPrice <= pos.trailingStop) {
        pos.status = 'STOPPED_OUT';
        this.closePosition(pos, 'Trailing stop hit');
      } else if (currentPrice >= pos.target) {
        pos.status = 'TARGET_HIT';
        this.closePosition(pos, 'Target achieved');
      }
    });

    // Calculate unrealized PnL
    this.pnl.unrealized = this.activePositions
      .filter(p => p.status === 'ACTIVE')
      .reduce((sum, p) => sum + p.pnl, 0);
  }

  /**
   * Close a position
   */
  closePosition(position, reason) {
    const trade = {
      ...position,
      exitPrice: position.currentPrice,
      exitTime: new Date().toISOString(),
      exitReason: reason,
    };

    this.pnl.realized += position.pnl;
    this.pnl.trades.push(trade);

    this.emit('trade_closed', trade);
  }

  /**
   * Remove closed positions
   */
  cleanPositions() {
    this.activePositions = this.activePositions.filter(p => p.status === 'ACTIVE');
  }

  /**
   * Get current bot state
   */
  getState() {
    return {
      running: this.running,
      signals: this.signals.slice(-20),
      positions: this.activePositions,
      pnl: {
        realized: Math.round(this.pnl.realized * 100) / 100,
        unrealized: Math.round(this.pnl.unrealized * 100) / 100,
        total: Math.round((this.pnl.realized + this.pnl.unrealized) * 100) / 100,
        tradeCount: this.pnl.trades.length,
        winRate: this.calculateWinRate(),
      },
      config: this.config,
    };
  }

  /**
   * Calculate win rate
   */
  calculateWinRate() {
    if (this.pnl.trades.length === 0) return 0;
    const wins = this.pnl.trades.filter(t => t.pnl > 0).length;
    return Math.round((wins / this.pnl.trades.length) * 100);
  }

  /**
   * Update bot configuration
   */
  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
  }

  /**
   * Event emitter
   */
  on(event, callback) {
    this.listeners.push({ event, callback });
  }

  emit(event, data) {
    this.listeners
      .filter(l => l.event === event)
      .forEach(l => l.callback(data));
  }

  /**
   * Generate demo data for when market is closed
   */
  generateDemoData() {
    const niftySpot = 23500 + Math.random() * 200 - 100;
    const bankNiftySpot = 49500 + Math.random() * 400 - 200;
    const atmNifty = Math.round(niftySpot / 50) * 50;
    const atmBankNifty = Math.round(bankNiftySpot / 100) * 100;

    const generateStrikes = (atm, step, spot) => {
      const strikes = [];
      for (let i = -5; i <= 5; i++) {
        const strike = atm + i * step;
        const distFromSpot = strike - spot;
        const ceIV = 12 + Math.random() * 5 + Math.abs(distFromSpot) / spot * 100;
        const peIV = 12 + Math.random() * 5 + Math.abs(distFromSpot) / spot * 100;

        strikes.push({
          strike,
          ceOI: Math.floor(Math.random() * 5000000 + 1000000),
          ceLTP: Math.max(5, Math.round((Math.max(0, spot - strike) + Math.random() * 100) * 100) / 100),
          ceIV: Math.round(ceIV * 10) / 10,
          ceOIChange: Math.floor(Math.random() * 200000 - 50000),
          peOI: Math.floor(Math.random() * 5000000 + 1000000),
          peLTP: Math.max(5, Math.round((Math.max(0, strike - spot) + Math.random() * 100) * 100) / 100),
          peIV: Math.round(peIV * 10) / 10,
          peOIChange: Math.floor(Math.random() * 200000 - 50000),
        });
      }
      return strikes;
    };

    const niftyStrikes = generateStrikes(atmNifty, 50, niftySpot);
    const bankNiftyStrikes = generateStrikes(atmBankNifty, 100, bankNiftySpot);

    const calcPCR = (strikes) => {
      const totalPutOI = strikes.reduce((s, st) => s + st.peOI, 0);
      const totalCallOI = strikes.reduce((s, st) => s + st.ceOI, 0);
      return totalCallOI > 0 ? (totalPutOI / totalCallOI).toFixed(2) : 1;
    };

    const niftyPCR = parseFloat(calcPCR(niftyStrikes));
    const bankNiftyPCR = parseFloat(calcPCR(bankNiftyStrikes));

    const buildAnalysis = (symbol, spot, atm, strikes, pcr, lotSize) => {
      const maxCallOI = strikes.reduce((max, s) => s.ceOI > max.oi ? { strike: s.strike, oi: s.ceOI } : max, { strike: 0, oi: 0 });
      const maxPutOI = strikes.reduce((max, s) => s.peOI > max.oi ? { strike: s.strike, oi: s.peOI } : max, { strike: 0, oi: 0 });

      const oiDirection = pcr > 1.1 ? 'BULLISH' : pcr < 0.85 ? 'BEARISH' : 'NEUTRAL';

      let sentimentScore = 0;
      if (pcr > 1.2) sentimentScore += 30;
      else if (pcr < 0.7) sentimentScore -= 30;
      if (oiDirection === 'BULLISH') sentimentScore += 25;
      if (oiDirection === 'BEARISH') sentimentScore -= 25;

      const sentimentLabel = sentimentScore > 20 ? 'BULLISH' : sentimentScore < -20 ? 'BEARISH' : 'NEUTRAL';

      return {
        symbol,
        spot: Math.round(spot * 100) / 100,
        atmStrike: atm,
        pcr,
        atmIV: {
          call: strikes.find(s => s.strike === atm)?.ceIV || 15,
          put: strikes.find(s => s.strike === atm)?.peIV || 15,
          avg: ((strikes.find(s => s.strike === atm)?.ceIV || 15) + (strikes.find(s => s.strike === atm)?.peIV || 15)) / 2,
        },
        oiAnalysis: {
          callOIAboveATM: strikes.filter(s => s.strike >= atm).reduce((sum, s) => sum + s.ceOI, 0),
          putOIBelowATM: strikes.filter(s => s.strike <= atm).reduce((sum, s) => sum + s.peOI, 0),
          callOIBuildUp: strikes.filter(s => s.ceOIChange > 0).reduce((sum, s) => sum + s.ceOIChange, 0),
          putOIBuildUp: strikes.filter(s => s.peOIChange > 0).reduce((sum, s) => sum + s.peOIChange, 0),
          callUnwinding: strikes.filter(s => s.ceOIChange < 0).reduce((sum, s) => sum + Math.abs(s.ceOIChange), 0),
          putUnwinding: strikes.filter(s => s.peOIChange < 0).reduce((sum, s) => sum + Math.abs(s.peOIChange), 0),
          direction: oiDirection,
          strength: 30 + Math.random() * 40,
        },
        momentum: {
          direction: sentimentLabel,
          strength: Math.abs(sentimentScore) + Math.random() * 20,
          rangePosition: ((spot - maxPutOI.strike) / (maxCallOI.strike - maxPutOI.strike)) * 100,
        },
        supportResistance: {
          spot,
          resistance: {
            primary: maxCallOI.strike,
            primaryOI: maxCallOI.oi,
            top3: strikes.sort((a, b) => b.ceOI - a.ceOI).slice(0, 3).map(s => ({ strike: s.strike, oi: s.ceOI })),
          },
          support: {
            primary: maxPutOI.strike,
            primaryOI: maxPutOI.oi,
            top3: strikes.sort((a, b) => b.peOI - a.peOI).slice(0, 3).map(s => ({ strike: s.strike, oi: s.peOI })),
          },
          range: { lower: maxPutOI.strike, upper: maxCallOI.strike, width: maxCallOI.strike - maxPutOI.strike },
        },
        signals: [],
        sentiment: { score: sentimentScore, label: sentimentLabel },
        nearbyStrikes: strikes,
        timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      };
    };

    return {
      analysis: {
        nifty: buildAnalysis('NIFTY', niftySpot, atmNifty, niftyStrikes, niftyPCR, 25),
        bankNifty: buildAnalysis('BANKNIFTY', bankNiftySpot, atmBankNifty, bankNiftyStrikes, bankNiftyPCR, 15),
      },
      signals: this.signals.slice(-20),
      positions: this.activePositions,
      pnl: this.getState().pnl,
      timestamp: new Date().toISOString(),
      isDemo: true,
    };
  }
}

module.exports = ScalpingBotEngine;
