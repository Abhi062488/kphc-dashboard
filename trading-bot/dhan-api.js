/**
 * Dhan API Integration for Live Market Data
 * Fetches real-time options chain, quotes, and market data for NIFTY & BANKNIFTY
 *
 * Dhan API Docs: https://dhanhq.co/docs/v2/
 */

const https = require('https');

class DhanAPI {
  constructor(accessToken, clientId) {
    this.accessToken = accessToken || process.env.DHAN_ACCESS_TOKEN || '';
    this.clientId = clientId || process.env.DHAN_CLIENT_ID || '';
    this.baseUrl = 'api.dhan.co';
    this.cache = {};
    this.cacheTTL = 2000; // 2 seconds
    this.lastFetchTime = {};

    // Dhan security IDs for indices
    this.SECURITY_IDS = {
      NIFTY: 13, // NIFTY 50 index
      BANKNIFTY: 25, // BANK NIFTY index
      SENSEX: 51, // SENSEX index
    };

    // Exchange segments
    this.SEGMENTS = {
      NSE_FNO: 'NSE_FNO',
      BSE_FNO: 'BSE_FNO',
      IDX: 'IDX_I',
    };
  }

  /**
   * Make authenticated API request to Dhan
   */
  async request(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.baseUrl,
        path: path,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'access-token': this.accessToken,
          'client-id': this.clientId,
          'Accept': 'application/json',
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              resolve(JSON.parse(data));
            } else {
              console.error(`[Dhan] API Error ${res.statusCode}:`, data.substring(0, 200));
              resolve(null);
            }
          } catch (e) {
            console.error('[Dhan] Parse error:', e.message);
            resolve(null);
          }
        });
      });

      req.on('error', (err) => {
        console.error('[Dhan] Request error:', err.message);
        resolve(null);
      });

      req.setTimeout(10000, () => {
        req.destroy();
        resolve(null);
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  /**
   * Get option chain for an index
   * @param {string} symbol - 'NIFTY' or 'BANKNIFTY'
   */
  async getOptionChain(symbol = 'NIFTY') {
    const cacheKey = `chain_${symbol}`;
    const now = Date.now();
    if (this.cache[cacheKey] && (now - this.lastFetchTime[cacheKey]) < this.cacheTTL) {
      return this.cache[cacheKey];
    }

    const underlyingScrip = symbol === 'NIFTY' ? 'NIFTY' : symbol === 'BANKNIFTY' ? 'BANKNIFTY' : 'NIFTY';

    const data = await this.request('POST', '/v2/optionchain', {
      UnderlyingScrip: underlyingScrip,
      UnderlyingSeg: 'IDX_I',
      ExpiryDate: '', // Empty = nearest expiry
    });

    if (data) {
      this.cache[cacheKey] = data;
      this.lastFetchTime[cacheKey] = now;
    }

    return data;
  }

  /**
   * Get LTP (Last Traded Price) for multiple instruments
   * @param {Array} instruments - Array of {exchangeSegment, securityId}
   */
  async getLTP(instruments) {
    const data = await this.request('POST', '/v2/marketfeed/ltp', instruments);
    return data;
  }

  /**
   * Get OHLC data for instruments
   */
  async getOHLC(instruments) {
    const data = await this.request('POST', '/v2/marketfeed/ohlc', instruments);
    return data;
  }

  /**
   * Get market quote (full) for instruments
   */
  async getQuote(instruments) {
    const data = await this.request('POST', '/v2/marketfeed/quote', instruments);
    return data;
  }

  /**
   * Parse Dhan option chain into our standard format
   */
  parseOptionChain(dhanData, symbol) {
    if (!dhanData || !dhanData.data) return null;

    const chainData = dhanData.data;
    const spotPrice = chainData.last_price || chainData.ltp || 0;

    // Group by strike price
    const strikeMap = {};
    let totalCallOI = 0, totalPutOI = 0;

    if (chainData.oc) {
      // Option chain format from Dhan
      chainData.oc.forEach(item => {
        const strike = item.strike_price || item.strikePrice;
        if (!strikeMap[strike]) {
          strikeMap[strike] = { strike, CE: null, PE: null };
        }

        if (item.option_type === 'CE' || item.optionType === 'CALL') {
          strikeMap[strike].CE = {
            oi: item.oi || item.open_interest || 0,
            oiChange: item.oi_change || item.changeinOpenInterest || 0,
            volume: item.volume || item.totalTradedVolume || 0,
            iv: item.iv || item.implied_volatility || 0,
            ltp: item.ltp || item.last_price || 0,
            change: item.change || 0,
            bidPrice: item.bid_price || item.bidprice || 0,
            askPrice: item.ask_price || item.askPrice || 0,
          };
          totalCallOI += strikeMap[strike].CE.oi;
        }

        if (item.option_type === 'PE' || item.optionType === 'PUT') {
          strikeMap[strike].PE = {
            oi: item.oi || item.open_interest || 0,
            oiChange: item.oi_change || item.changeinOpenInterest || 0,
            volume: item.volume || item.totalTradedVolume || 0,
            iv: item.iv || item.implied_volatility || 0,
            ltp: item.ltp || item.last_price || 0,
            change: item.change || 0,
            bidPrice: item.bid_price || item.bidprice || 0,
            askPrice: item.ask_price || item.askPrice || 0,
          };
          totalPutOI += strikeMap[strike].PE.oi;
        }
      });
    }

    const strikes = Object.values(strikeMap).sort((a, b) => a.strike - b.strike);
    const pcr = totalCallOI > 0 ? (totalPutOI / totalCallOI).toFixed(2) : '0';

    return {
      timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      underlyingValue: spotPrice,
      data: strikes.map(s => ({
        strikePrice: s.strike,
        CE: s.CE,
        PE: s.PE,
      })),
      totals: {
        callOI: totalCallOI,
        putOI: totalPutOI,
      },
      pcr: pcr,
    };
  }

  /**
   * Get expiry dates for options
   */
  async getExpiryDates(symbol = 'NIFTY') {
    const data = await this.request('POST', '/v2/optionchain', {
      UnderlyingScrip: symbol,
      UnderlyingSeg: 'IDX_I',
    });

    if (data && data.data && data.data.expiryDates) {
      return data.data.expiryDates;
    }
    return [];
  }

  /**
   * Check if Dhan API is configured and working
   */
  async isConnected() {
    if (!this.accessToken || !this.clientId) {
      return { connected: false, reason: 'Missing API credentials' };
    }

    try {
      const data = await this.request('GET', '/v2/fundlimit');
      if (data) {
        return { connected: true, reason: 'Connected to Dhan API' };
      }
      return { connected: false, reason: 'API returned no data' };
    } catch (err) {
      return { connected: false, reason: err.message };
    }
  }

  /**
   * Get historical candle data (for technical indicators)
   * @param {string} securityId
   * @param {string} interval - '1', '5', '15', '25', '60' (minutes) or 'D' (daily)
   */
  async getHistoricalData(securityId, exchangeSegment, interval = '5', fromDate, toDate) {
    if (!fromDate) {
      const d = new Date();
      fromDate = d.toISOString().split('T')[0];
    }
    if (!toDate) {
      toDate = fromDate;
    }

    const data = await this.request('POST', '/v2/charts/intraday', {
      securityId: securityId,
      exchangeSegment: exchangeSegment,
      instrument: 'INDEX',
      interval: interval,
      fromDate: fromDate,
      toDate: toDate,
    });

    return data;
  }
}

module.exports = DhanAPI;
