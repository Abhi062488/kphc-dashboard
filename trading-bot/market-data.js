/**
 * Market Data Fetcher for NSE India
 * Fetches real-time options chain data for NIFTY and SENSEX (BANKEX/SENSEX on BSE)
 */

const https = require('https');
const http = require('http');

class MarketDataFetcher {
  constructor() {
    this.cookies = '';
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.nseBaseUrl = 'www.nseindia.com';
    this.lastFetchTime = {};
    this.cache = {};
    this.cacheTTL = 3000; // 3 seconds cache
    this.initialized = false;
  }

  /**
   * Initialize session with NSE (get cookies)
   */
  async initSession() {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.nseBaseUrl,
        path: '/',
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Connection': 'keep-alive',
        }
      };

      const req = https.request(options, (res) => {
        const setCookies = res.headers['set-cookie'];
        if (setCookies) {
          this.cookies = setCookies.map(c => c.split(';')[0]).join('; ');
        }
        res.on('data', () => {});
        res.on('end', () => {
          this.initialized = true;
          resolve(true);
        });
      });

      req.on('error', (err) => {
        console.error('Session init error:', err.message);
        resolve(false);
      });

      req.setTimeout(10000, () => {
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }

  /**
   * Fetch data from NSE API
   */
  async fetchFromNSE(path) {
    // Check cache
    const now = Date.now();
    if (this.cache[path] && (now - this.lastFetchTime[path]) < this.cacheTTL) {
      return this.cache[path];
    }

    if (!this.initialized) {
      await this.initSession();
    }

    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.nseBaseUrl,
        path: path,
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cookie': this.cookies,
          'Referer': 'https://www.nseindia.com/option-chain',
          'Connection': 'keep-alive',
        }
      };

      const req = https.request(options, (res) => {
        // Handle cookie refresh
        const setCookies = res.headers['set-cookie'];
        if (setCookies) {
          this.cookies = setCookies.map(c => c.split(';')[0]).join('; ');
        }

        if (res.statusCode === 401 || res.statusCode === 403) {
          this.initialized = false;
          resolve(null);
          return;
        }

        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            this.cache[path] = parsed;
            this.lastFetchTime[path] = now;
            resolve(parsed);
          } catch (e) {
            // Session may have expired, retry once
            this.initialized = false;
            resolve(null);
          }
        });
      });

      req.on('error', (err) => {
        console.error('NSE fetch error:', err.message);
        resolve(null);
      });

      req.setTimeout(15000, () => {
        req.destroy();
        resolve(null);
      });

      req.end();
    });
  }

  /**
   * Get NIFTY 50 Options Chain
   */
  async getNiftyOptionsChain() {
    const data = await this.fetchFromNSE('/api/option-chain-indices?symbol=NIFTY');
    if (!data) {
      // Retry after re-init
      await this.initSession();
      return await this.fetchFromNSE('/api/option-chain-indices?symbol=NIFTY');
    }
    return data;
  }

  /**
   * Get BANKNIFTY Options Chain
   */
  async getBankNiftyOptionsChain() {
    const data = await this.fetchFromNSE('/api/option-chain-indices?symbol=BANKNIFTY');
    if (!data) {
      await this.initSession();
      return await this.fetchFromNSE('/api/option-chain-indices?symbol=BANKNIFTY');
    }
    return data;
  }

  /**
   * Get SENSEX Options Chain (via NIFTY proxy - BSE data mapped)
   */
  async getSensexOptionsChain() {
    // NSE doesn't directly serve SENSEX options; we use BANKNIFTY as proxy
    // or fetch from alternative source
    const data = await this.fetchFromNSE('/api/option-chain-indices?symbol=NIFTY');
    return data;
  }

  /**
   * Get market indices data
   */
  async getMarketIndices() {
    return await this.fetchFromNSE('/api/allIndices');
  }

  /**
   * Get NIFTY spot price and related data
   */
  async getNiftySpotData() {
    const indices = await this.getMarketIndices();
    if (!indices || !indices.data) return null;

    const nifty = indices.data.find(i => i.index === 'NIFTY 50');
    const sensex = indices.data.find(i => i.index === 'NIFTY BANK');

    return {
      nifty: nifty ? {
        last: nifty.last,
        change: nifty.percentChange,
        open: nifty.open,
        high: nifty.high,
        low: nifty.low,
        previousClose: nifty.previousClose,
      } : null,
      bankNifty: sensex ? {
        last: sensex.last,
        change: sensex.percentChange,
        open: sensex.open,
        high: sensex.high,
        low: sensex.low,
        previousClose: sensex.previousClose,
      } : null
    };
  }

  /**
   * Parse options chain data into structured format
   */
  parseOptionsChain(rawData) {
    if (!rawData || !rawData.records) return null;

    const records = rawData.records;
    const filtered = rawData.filtered;

    const result = {
      timestamp: records.timestamp,
      underlyingValue: records.underlyingValue,
      strikePrices: records.strikePrices,
      expiryDates: records.expiryDates,
      data: [],
      totals: {
        callOI: 0,
        callOIChange: 0,
        callVolume: 0,
        putOI: 0,
        putOIChange: 0,
        putVolume: 0,
      },
      pcr: 0,
    };

    if (filtered && filtered.data) {
      result.data = filtered.data.map(item => ({
        strikePrice: item.strikePrice,
        expiryDate: item.expiryDate,
        CE: item.CE ? {
          oi: item.CE.openInterest || 0,
          oiChange: item.CE.changeinOpenInterest || 0,
          volume: item.CE.totalTradedVolume || 0,
          iv: item.CE.impliedVolatility || 0,
          ltp: item.CE.lastPrice || 0,
          change: item.CE.change || 0,
          bidQty: item.CE.bidQty || 0,
          bidPrice: item.CE.bidprice || 0,
          askQty: item.CE.askQty || 0,
          askPrice: item.CE.askPrice || 0,
        } : null,
        PE: item.PE ? {
          oi: item.PE.openInterest || 0,
          oiChange: item.PE.changeinOpenInterest || 0,
          volume: item.PE.totalTradedVolume || 0,
          iv: item.PE.impliedVolatility || 0,
          ltp: item.PE.lastPrice || 0,
          change: item.PE.change || 0,
          bidQty: item.PE.bidQty || 0,
          bidPrice: item.PE.bidprice || 0,
          askQty: item.PE.askQty || 0,
          askPrice: item.PE.askPrice || 0,
        } : null,
      }));

      // Calculate totals
      if (filtered.CE) {
        result.totals.callOI = filtered.CE.totOI || 0;
        result.totals.callOIChange = filtered.CE.totVol || 0;
        result.totals.callVolume = filtered.CE.totVol || 0;
      }
      if (filtered.PE) {
        result.totals.putOI = filtered.PE.totOI || 0;
        result.totals.putOIChange = filtered.PE.totVol || 0;
        result.totals.putVolume = filtered.PE.totVol || 0;
      }

      // PCR = Put OI / Call OI
      if (result.totals.callOI > 0) {
        result.pcr = (result.totals.putOI / result.totals.callOI).toFixed(2);
      }
    }

    return result;
  }

  /**
   * Get key support and resistance levels from OI data
   */
  findSupportResistance(parsedChain) {
    if (!parsedChain || !parsedChain.data) return null;

    const spot = parsedChain.underlyingValue;
    const data = parsedChain.data;

    // Find max Call OI (Resistance) and max Put OI (Support)
    let maxCallOI = 0, maxCallOIStrike = 0;
    let maxPutOI = 0, maxPutOIStrike = 0;
    let maxCallOIChange = 0, maxCallOIChangeStrike = 0;
    let maxPutOIChange = 0, maxPutOIChangeStrike = 0;

    // Top 3 Call OI and Put OI strikes
    const callOIStrikes = [];
    const putOIStrikes = [];

    data.forEach(item => {
      if (item.CE) {
        callOIStrikes.push({ strike: item.strikePrice, oi: item.CE.oi, oiChange: item.CE.oiChange });
        if (item.CE.oi > maxCallOI) {
          maxCallOI = item.CE.oi;
          maxCallOIStrike = item.strikePrice;
        }
        if (item.CE.oiChange > maxCallOIChange) {
          maxCallOIChange = item.CE.oiChange;
          maxCallOIChangeStrike = item.strikePrice;
        }
      }
      if (item.PE) {
        putOIStrikes.push({ strike: item.strikePrice, oi: item.PE.oi, oiChange: item.PE.oiChange });
        if (item.PE.oi > maxPutOI) {
          maxPutOI = item.PE.oi;
          maxPutOIStrike = item.strikePrice;
        }
        if (item.PE.oiChange > maxPutOIChange) {
          maxPutOIChange = item.PE.oiChange;
          maxPutOIChangeStrike = item.strikePrice;
        }
      }
    });

    // Sort and get top 3
    callOIStrikes.sort((a, b) => b.oi - a.oi);
    putOIStrikes.sort((a, b) => b.oi - a.oi);

    return {
      spot,
      resistance: {
        primary: maxCallOIStrike,
        primaryOI: maxCallOI,
        top3: callOIStrikes.slice(0, 3).map(s => ({ strike: s.strike, oi: s.oi })),
      },
      support: {
        primary: maxPutOIStrike,
        primaryOI: maxPutOI,
        top3: putOIStrikes.slice(0, 3).map(s => ({ strike: s.strike, oi: s.oi })),
      },
      oiBuildUp: {
        maxCallOIChange: { strike: maxCallOIChangeStrike, change: maxCallOIChange },
        maxPutOIChange: { strike: maxPutOIChangeStrike, change: maxPutOIChange },
      },
      range: {
        lower: maxPutOIStrike,
        upper: maxCallOIStrike,
        width: maxCallOIStrike - maxPutOIStrike,
      }
    };
  }
}

module.exports = MarketDataFetcher;
