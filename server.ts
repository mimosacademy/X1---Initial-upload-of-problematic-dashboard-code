import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import pino from 'pino';
import { z } from 'zod';
import { parseEnv } from 'znv';
import rateLimit from 'express-rate-limit';
import NodeCache from 'node-cache';
import * as Sentry from '@sentry/node';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
  },
});

// Environment variable validation using znv
const env = parseEnv(process.env, {
  GEMINI_API_KEY: z.string().optional().default(''),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['dev', 'prod', 'development', 'production']).default('dev'),
  SENTRY_DSN: z.string().optional().default(''),
});

// Initialize Sentry for error tracking if SENTRY_DSN is provided
if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN as string,
    environment: env.NODE_ENV as string,
  });
  logger.info('Sentry error tracking initialized.');
}

const SignalSchema = z.object({
  coin: z.string().min(1),
  direction: z.enum(['LONG', 'SHORT']),
  score: z.number().min(0).max(100),
  entryPrice: z.number().positive(),
});

// Cache engine with standard TTL (600 seconds)
const appCache = new NodeCache({ stdTTL: 600 });

// Helper to clear caches
function clearCaches() {
  appCache.del('signals');
  appCache.del('performance');
  appCache.del('historical-logs');
  logger.info('Cache cleared successfully.');
}

// ==========================================
// RESILIENT LOCAL JSON DATABASE (FIREBASE ALTERNATIVE)
// ==========================================
class LocalDocRef {
  constructor(private col: string, private id: string, private dbInstance: LocalDb) {}

  async get() {
    const data = this.dbInstance.getDoc(this.col, this.id);
    return {
      exists: data !== undefined,
      data: () => data,
    };
  }

  async set(data: any) {
    this.dbInstance.setDoc(this.col, this.id, data);
  }

  async update(data: any) {
    this.dbInstance.updateDoc(this.col, this.id, data);
  }

  async delete() {
    this.dbInstance.deleteDoc(this.col, this.id);
  }
}

class LocalQuery {
  private filters: Array<{ field: string; op: string; val: any }> = [];
  private orderField: string | null = null;
  private orderDirection: 'asc' | 'desc' = 'asc';
  private limitCount: number | null = null;

  constructor(private col: string, private dbInstance: LocalDb) {}

  where(field: string, op: string, val: any) {
    this.filters.push({ field, op, val });
    return this;
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
    this.orderField = field;
    this.orderDirection = direction;
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  async get() {
    let docs = this.dbInstance.getCollection(this.col);

    // Apply filters
    for (const filter of this.filters) {
      docs = docs.filter(doc => {
        const parts = filter.field.split('.');
        let val = doc;
        for (const part of parts) {
          if (val === undefined || val === null) break;
          val = val[part];
        }

        if (filter.op === '==') return val === filter.val;
        if (filter.op === '>=') return val >= filter.val;
        if (filter.op === '<=') return val <= filter.val;
        return true;
      });
    }

    // Apply ordering
    if (this.orderField) {
      docs.sort((a, b) => {
        const parts = this.orderField!.split('.');
        let valA = a;
        let valB = b;
        for (const part of parts) {
          if (valA !== undefined && valA !== null) valA = valA[part];
          if (valB !== undefined && valB !== null) valB = valB[part];
        }
        if (valA < valB) return this.orderDirection === 'asc' ? -1 : 1;
        if (valA > valB) return this.orderDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    // Apply limit
    if (this.limitCount !== null) {
      docs = docs.slice(0, this.limitCount);
    }

    const docSnaps = docs.map(d => ({
      id: d.id || '',
      exists: true,
      data: () => d,
    }));

    return {
      empty: docSnaps.length === 0,
      docs: docSnaps,
    };
  }
}

class LocalDb {
  private filePath: string;
  private memoryData: Record<string, Record<string, any>> = {};

  constructor() {
    const dir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.filePath = path.join(dir, 'local_db.json');
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, 'utf-8');
        this.memoryData = JSON.parse(fileContent);
      } else {
        this.memoryData = {};
        this.save();
      }
    } catch (err) {
      console.error('[LocalDb] Error loading file, initializing empty:', err);
      this.memoryData = {};
    }
  }

  private save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.memoryData, null, 2), 'utf-8');
    } catch (err) {
      console.error('[LocalDb] Error writing file:', err);
    }
  }

  getDoc(col: string, id: string) {
    if (!this.memoryData[col]) return undefined;
    return this.memoryData[col][id];
  }

  setDoc(col: string, id: string, data: any) {
    if (!this.memoryData[col]) {
      this.memoryData[col] = {};
    }
    this.memoryData[col][id] = { ...data, id };
    this.save();
  }

  updateDoc(col: string, id: string, data: any) {
    if (!this.memoryData[col]) {
      this.memoryData[col] = {};
    }
    const current = this.memoryData[col][id] || {};
    this.memoryData[col][id] = { ...current, ...data, id };
    this.save();
  }

  deleteDoc(col: string, id: string) {
    if (this.memoryData[col] && this.memoryData[col][id]) {
      delete this.memoryData[col][id];
      this.save();
    }
  }

  getCollection(col: string): any[] {
    if (!this.memoryData[col]) return [];
    return Object.values(this.memoryData[col]);
  }

  collection(name: string) {
    const self = this;
    return {
      doc(id: string) {
        return new LocalDocRef(name, id, self);
      },
      where(field: string, op: string, val: any) {
        return new LocalQuery(name, self).where(field, op, val);
      },
      orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
        return new LocalQuery(name, self).orderBy(field, direction);
      },
      limit(count: number) {
        return new LocalQuery(name, self).limit(count);
      },
      async get() {
        return new LocalQuery(name, self).get();
      }
    };
  }
}

const db = new LocalDb();
import { FIXED_TRADE_PAIRS } from './src/config/pairs.js';
import {
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateATR,
} from './src/utils/indicators.js';
import { evaluateMarketRegime, REGIMES, getSwingStructure } from './src/utils/regimeEngine.js';
import { runAIDebateLayer } from './src/utils/aiDebateEngine.js';
import { Signal, SignalMetrics, SignalOutcome, AppSettings, MarketStatus } from './src/types.js';
import { startLiveFeed, getLivePrice, getAllLivePrices } from './src/services/liveFeed.js';

// Global cache objects for Binance Klines
interface CacheEntry {
  timestamp: number;
  data: any;
}

const klines1DCache: Record<string, CacheEntry> = {};
const klines4HCache: Record<string, CacheEntry> = {};
const nonExistentSymbols = new Set<string>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * In-memory resilient Binance request queue to prevent 429/418 rate limiting.
 */
class BinanceRequestQueue {
  private queue: Array<{
    url: string;
    retries: number;
    delayMs: number;
    resolve: (val: any) => void;
    reject: (err: any) => void;
  }> = [];
  private activeCount = 0;
  private maxConcurrency = 3;

  async enqueue(url: string, retries = 3, delayMs = 2000): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({ url, retries, delayMs, resolve, reject });
      this.process();
    });
  }

  private async process() {
    if (this.activeCount >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this.activeCount++;
    try {
      const res = await fetchBinanceWithRetryDirect(task.url, task.retries, task.delayMs);
      task.resolve(res);
    } catch (err) {
      task.reject(err);
    } finally {
      this.activeCount--;
      this.process();
    }
  }
}

const binanceQueue = new BinanceRequestQueue();

/**
 * Robust fetch with exponential backoff for Binance API 429/418/Network errors,
 * plus rate-limiting governor checking X-MBX-USED-WEIGHT-1M.
 */
async function fetchBinanceWithRetryDirect(url: string, retries = 3, delayMs = 2000): Promise<any> {
  try {
    const res = await fetch(url);

    // Read the 1-minute weight header
    const weightHeader = res.headers.get('x-mbx-used-weight-1m');
    if (weightHeader) {
      const currentWeight = parseInt(weightHeader, 10);
      if (currentWeight > 1920) { // 80% of 2400 is 1920
        logger.warn(`[Binance Rate Limit Governor] Used weight is high: ${currentWeight}/2400. Adding protective delay of 2000ms.`);
        await sleep(2000);
      }
    }

    if (res.status === 400) {
      const data = await res.json().catch(() => ({}));
      if (data.code === -1121 || (data.msg && data.msg.includes('Invalid symbol'))) {
        throw new Error(`SYMBOL_NOT_EXIST: ${url}`);
      }
    }

    if (res.status === 429 || res.status === 418) {
      if (retries > 1) {
        logger.warn(`[Binance Limit Error] Received HTTP ${res.status}. Retrying in ${delayMs}ms... (${retries - 1} retries left)`);
        await sleep(delayMs);
        return fetchBinanceWithRetryDirect(url, retries - 1, delayMs * 2);
      } else {
        throw new Error(`Binance returned persistent rate limit status: ${res.status}`);
      }
    }

    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
    }

    return await res.json();
  } catch (err: any) {
    if (err.message && err.message.includes('SYMBOL_NOT_EXIST')) {
      throw err;
    }
    if (retries > 1) {
      logger.warn(`[Binance Fetch Error] ${err.message}. Retrying in ${delayMs}ms... (${retries - 1} retries left)`);
      await sleep(delayMs);
      return fetchBinanceWithRetryDirect(url, retries - 1, delayMs * 2);
    }
    throw err;
  }
}

async function fetchBinanceWithRetry(url: string, retries = 3, delayMs = 2000): Promise<any> {
  return binanceQueue.enqueue(url, retries, delayMs);
}

/**
 * 1D Klines Loader: Cache and refresh once every 60 minutes
 */
async function getCachedKlines1D(symbol: string): Promise<any> {
  const now = Date.now();
  const cached = klines1DCache[symbol];
  if (cached && (now - cached.timestamp < 60 * 60 * 1000)) {
    return cached.data;
  }
  const data = await fetchBinanceWithRetry(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=250`);
  klines1DCache[symbol] = { timestamp: now, data };
  return data;
}

/**
 * 4H Klines Loader: Cache and refresh once every 30 minutes
 */
async function getCachedKlines4H(symbol: string): Promise<any> {
  const now = Date.now();
  const cached = klines4HCache[symbol];
  if (cached && (now - cached.timestamp < 30 * 60 * 1000)) {
    return cached.data;
  }
  const data = await fetchBinanceWithRetry(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=4h&limit=250`);
  klines4HCache[symbol] = { timestamp: now, data };
  return data;
}

const app = express();
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak permintaan dari IP ini. Sila cuba lagi selepas 15 minit.' },
});

app.use('/api/', (req, res, next) => {
  if (req.path === '/live-prices/stream') {
    return next();
  }
  return limiter(req, res, next);
});

const PORT = 3000;

// Global Cooldown and Settings Store
let lastScanTime = 0;
const COOLDOWN_MS = 60 * 1000; // 60 seconds manual scan cooldown

// Default Settings
const DEFAULT_SETTINGS: AppSettings = {
  minRR: 1.5,
  minScore: 70,
  minVolumeSpike: 120,
  minSampleSize: 20,
  universeSize: 100,
  allowRangeTrading: false,
};

// Get settings helper
async function getSettings(): Promise<AppSettings> {
  try {
    const settingsDoc = await db.collection('settings').doc('global').get();
    if (settingsDoc.exists) {
      return settingsDoc.data() as AppSettings;
    } else {
      await db.collection('settings').doc('global').set(DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }
  } catch (err) {
    console.error('Error fetching settings:', err);
    return DEFAULT_SETTINGS;
  }
}

// Function to generate Gemini Narrative in Bahasa Melayu (restricted to narrative reasoning)
async function generateNarrative(coin: string, direction: string, metrics: any): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.includes("MY_")) {
    return `Aliran ${direction === 'LONG' ? 'Bullish' : 'Bearish'} yang kuat dikesan pada ${coin}. EMA50 berada di atas EMA200 dengan lonjakan volume ${metrics.volumeSpike.toFixed(0)}% di pasaran futures.`;
  }

  const runWithRetry = async (retries = 1, delayMs = 1500): Promise<string> => {
    try {
      const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
      const prompt = `Anda adalah seorang pakar penganalisis pasaran crypto futures perpetual. Guna data numerik berikut untuk menjana penjelasan teknikal ringkas (maksimum 2 ayat sahaja) dalam Bahasa Melayu yang menerangkan mengapa signal ini dipilih. JANGAN sesekali mereka atau mengira semula nombor baru. Bahasa Melayu mestilah profesional, kemas dan padat.

      Coin: ${coin}
      Arah: ${direction}
      RSI 15M: ${metrics.rsi15M.toFixed(1)}
      RSI 4H: ${metrics.rsi4H.toFixed(1)}
      Volume Spike: ${metrics.volumeSpike.toFixed(0)}%
      Spread Bid-Ask: ${metrics.spread.toFixed(4)}%
      Funding Rate Semasa: ${metrics.fundingRate.toFixed(4)}%
      Trend EMA 1D & 4H: Selaras ${direction === 'LONG' ? 'Bullish' : 'Bearish'}
      
      Sila terangkan sebab teknikal utama dalam Bahasa Melayu.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: prompt,
      });

      return response.text?.trim() || `Aliran ${direction} disokong oleh momentum RSI dan lonjakan volume yang signifikan.`;
    } catch (err: any) {
      const isRateLimit = err?.message?.includes("429") || err?.message?.includes("RESOURCE_EXHAUSTED");
      if (retries > 0 && isRateLimit) {
        console.warn(`[Gemini Narrative Retry] Rate limited. Retrying in ${delayMs}ms...`);
        await sleep(delayMs);
        return runWithRetry(retries - 1, delayMs * 2);
      }
      throw err;
    }
  };

  try {
    return await runWithRetry();
  } catch (error) {
    console.error('Gemini API error generating narrative:', error);
    return `Isyarat ${direction} dikesan di mana kline berada dalam zon momentum sihat dengan pengesahan volume spike sebanyak ${metrics.volumeSpike.toFixed(0)}%.`;
  }
}

// Probability Score & Sample Size from Firestore Historical Logs
async function getProbabilityScore(direction: string, trendAlign: boolean, volumeSpikeOK: boolean, minSampleSize: number) {
  try {
    const querySnapshot = await db.collection('signals_history')
      .where('direction', '==', direction)
      .where('metrics.trendAlign', '==', trendAlign)
      .get();
    let finishedSignals = querySnapshot.docs
      .map(d => d.data() as Signal)
      .filter(s => s.outcome === 'WIN' || s.outcome === 'LOSS');

    if (volumeSpikeOK) {
      const settings = await getSettings();
      finishedSignals = finishedSignals.filter(s => s.metrics && s.metrics.volumeSpike >= settings.minVolumeSpike);
    }

    const total = finishedSignals.length;
    if (total < minSampleSize) {
      // Half credit if sample size is limited
      return {
        score: 7.5,
        sampleSize: total,
        winRate: total > 0 ? (finishedSignals.filter(s => s.outcome === 'WIN').length / total) * 100 : 0
      };
    }

    const wins = finishedSignals.filter(s => s.outcome === 'WIN').length;
    const winRate = (wins / total) * 100;
    // Normalized to 15 points
    const score = (winRate / 100) * 15;

    return {
      score,
      sampleSize: total,
      winRate
    };
  } catch (err) {
    console.error('Error calculating probability score:', err);
    return { score: 7.5, sampleSize: 0, winRate: 0 };
  }
}

// Seed historical logs if Firestore collection is empty
async function seedDatabaseIfEmpty() {
  try {
    const snapshot = await db.collection('signals_history').limit(1).get();
    if (!snapshot.empty) {
      console.log('[Seed] Database is already populated. Skipping seed.');
      return;
    }

    console.log('[Seed] Database is empty. Seeding historical signals...');
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const mockCoins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'NEARUSDT'];
    
    // Seed 25 signals spread over the last 15 days
    for (let i = 0; i < 25; i++) {
      const coin = mockCoins[i % mockCoins.length];
      const direction = i % 3 === 0 ? 'SHORT' : 'LONG';
      const timestamp = now - (15 - (i * 0.5)) * oneDay;
      const entryPrice = coin === 'BTCUSDT' ? 95000 - (i * 100) : coin === 'ETHUSDT' ? 3400 - (i * 5) : 100 - i;
      
      // Determine TP / SL
      const atrVal = entryPrice * 0.015; // 1.5% ATR approximate
      const stopLoss = direction === 'LONG' ? entryPrice - 1.2 * atrVal : entryPrice + 1.2 * atrVal;
      const takeProfit1 = direction === 'LONG' ? entryPrice + 2.5 * (entryPrice - stopLoss) : entryPrice - 2.5 * (stopLoss - entryPrice);
      const takeProfit2 = direction === 'LONG' ? entryPrice + 3.5 * (entryPrice - stopLoss) : entryPrice - 3.5 * (stopLoss - entryPrice);
      const takeProfit3 = direction === 'LONG' ? entryPrice + 5.0 * (entryPrice - stopLoss) : entryPrice - 5.0 * (stopLoss - entryPrice);
      
      // Outcomes distribution: 16 WINs, 7 LOSSes, 2 EXPIRED
      let outcome: SignalOutcome = 'WIN';
      if (i % 3 === 1) outcome = 'LOSS';
      if (i % 12 === 0) outcome = 'EXPIRED';

      const volumeSpike = 160 + (i * 8);
      const score = 72 + (i % 25); // Score between 72 and 97

      const metrics: SignalMetrics = {
        trend1D: direction === 'LONG' ? 'BULLISH' : 'BEARISH',
        trend4H: direction === 'LONG' ? 'BULLISH' : 'BEARISH',
        trendAlign: true,
        rsi4H: direction === 'LONG' ? 55 : 42,
        rsi15M: direction === 'LONG' ? 58 : 38,
        macdHistogram: [0.1, 0.2, 0.3],
        macdAlign: true,
        volumeSpike,
        cvdDelta10: direction === 'LONG' ? 120000 : -120000,
        cvdAlign: true,
        bidAskRatio: direction === 'LONG' ? 1.24 : 0.82,
        spread: 0.01 + (i % 3) * 0.01,
        fundingRate: direction === 'LONG' ? 0.012 : -0.005,
        openInterestChange: 2.1 + i * 0.1
      };

      const regimeId = (i % 8) + 1;
      const regimeLabels = [
        '🟢 AGGRESSIVE LONG',
        '🔥 MUST FOLLOW LONG',
        '✅ SAFE LONG',
        '🟡 RANGE TRADING',
        'Wait / No Trade',
        '🚨 MUST FOLLOW SHORT',
        '🔴 SAFE SHORT',
        '🚨 AGGRESSIVE SHORT'
      ];
      const regimeLabel = regimeLabels[regimeId - 1];

      const mockSignal: Signal = {
        id: `seeded_${i}_${timestamp}`,
        coin,
        direction,
        timestamp,
        entryPrice,
        stopLoss,
        takeProfit1,
        takeProfit2,
        takeProfit3,
        score,
        outcome,
        outcomeTimestamp: timestamp + (2 * 60 * 60 * 1000), // hit 2 hours later
        metrics,
        scoreBreakdown: {
          trend: 26,
          momentum: 21,
          volume: 16,
          probability: 11,
          liquidity: 8
        },
        sampleSize: 15 + i,
        winRateHistorical: 65,
        regimeId,
        regimeLabel,
        regimeStable: true,
        narrative: `Seeded signal. Aliran ${direction === 'LONG' ? 'BULLISH' : 'BEARISH'} kuat dikesan dengan sokongan volume yang melonjak tinggi.`
      };

      await db.collection('signals_history').doc(mockSignal.id).set(mockSignal);
    }
    console.log('[Seed] Database seeded successfully with 25 historical logs.');
  } catch (err) {
    console.error('[Seed] Database seeding error:', err);
  }
}

// Background Task to follow up and update outcomes of PENDING signals
async function updatePendingSignals() {
  try {
    console.log('[Outcome Tracker] Checking for pending signals...');
    const now = Date.now();
    const querySnapshot = await db.collection('signals_history')
      .where('outcome', '==', 'PENDING')
      .get();

    if (querySnapshot.empty) {
      console.log('[Outcome Tracker] No pending signals to update.');
      return;
    }

    let hasChanges = false;

    for (const docSnap of querySnapshot.docs) {
      const signal = docSnap.data() as Signal;
      const signalId = docSnap.id;

      try {
        const response = await fetch(
          `https://fapi.binance.com/fapi/v1/klines?symbol=${signal.coin}&interval=15m&startTime=${signal.timestamp}&limit=100`
        );
        if (!response.ok) {
          console.warn(`[Outcome Tracker] Failed to fetch klines for ${signal.coin}. Status: ${response.status}`);
          continue;
        }

        const klines: any[] = await response.json();
        if (klines.length <= 1) continue;

        let outcome: SignalOutcome = 'PENDING';
        let outcomeTime = 0;

        // Start evaluating from the first candle after trigger
        for (let i = 1; i < klines.length; i++) {
          const k = klines[i];
          const high = parseFloat(k[2]);
          const low = parseFloat(k[3]);
          const closeTime = parseInt(k[6]);

          if (signal.direction === 'LONG') {
            if (low <= signal.stopLoss) {
              outcome = 'LOSS';
              outcomeTime = closeTime;
              break;
            }
            if (high >= signal.takeProfit1) {
              outcome = 'WIN';
              outcomeTime = closeTime;
              break;
            }
          } else {
            // SHORT
            if (high >= signal.stopLoss) {
              outcome = 'LOSS';
              outcomeTime = closeTime;
              break;
            }
            if (low <= signal.takeProfit1) {
              outcome = 'WIN';
              outcomeTime = closeTime;
              break;
            }
          }
        }

        // Auto expire after 4 hours (16 candles of 15M) if still pending
        const ageMs = now - signal.timestamp;
        if (outcome === 'PENDING' && ageMs >= 4 * 60 * 60 * 1000) {
          const lastKline = klines[klines.length - 1];
          const lastClose = parseFloat(lastKline[4]);
          
          if (signal.direction === 'LONG') {
            outcome = lastClose >= signal.entryPrice ? 'WIN' : 'LOSS';
          } else {
            outcome = lastClose <= signal.entryPrice ? 'WIN' : 'LOSS';
          }
          outcomeTime = parseInt(lastKline[6]);
        }

        if (outcome !== 'PENDING') {
          await db.collection('signals_history').doc(signalId).update({
            outcome,
            outcomeTimestamp: outcomeTime,
          });
          hasChanges = true;
          console.log(`[Outcome Tracker] Resolved Signal ${signalId} (${signal.coin}) -> ${outcome}`);
        }
      } catch (err) {
        console.error(`[Outcome Tracker] Error checking signal ${signalId}:`, err);
      }
    }

    if (hasChanges) {
      clearCaches();
    }
  } catch (err) {
    console.error('[Outcome Tracker] Error scanning pending signals:', err);
  }
}

// Core Market Scan Logic (Deterministic Indicator calculations on Binance data)
async function runMarketScan(): Promise<Signal[]> {
  const startMs = Date.now();
  console.log('[Market Scan] Starting scanning algorithm with FIXED TRADE PAIRS universe...');

  // 1. Fetch user settings
  const settings = await getSettings();

  // 2. Fetch Binance 24hr tickers for current market stats
  const tickerRes = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
  if (!tickerRes.ok) throw new Error('Binance ticker request failed');
  const tickers: any[] = await tickerRes.json();

  // Create lookup map of all Binance tickers
  const tickerMap = new Map<string, any>();
  tickers.forEach(t => tickerMap.set(t.symbol, t));

  // Build scanning universe from FIXED_TRADE_PAIRS
  const universe: any[] = [];
  for (const symbol of FIXED_TRADE_PAIRS) {
    if (nonExistentSymbols.has(symbol)) {
      continue;
    }
    const ticker = tickerMap.get(symbol);
    if (ticker) {
      universe.push(ticker);
    } else {
      console.warn(`[Market Scan] Simbol ${symbol} tidak aktif atau tidak wujud di Binance Futures tickers. Melangkau.`);
      nonExistentSymbols.add(symbol);
    }
  }

  console.log(`[Market Scan] Scanning universe of ${universe.length} fixed trade pairs (Skipping ${nonExistentSymbols.size} invalid symbols).`);

  // Fetch Funding rates lookup map (Premium Index)
  const premiumIndexRes = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex');
  const premiumIndexList: any[] = premiumIndexRes.ok ? await premiumIndexRes.json() : [];
  const fundingRateMap = new Map<string, number>();
  premiumIndexList.forEach(item => {
    fundingRateMap.set(item.symbol, parseFloat(item.lastFundingRate));
  });

  const validSignals: Signal[] = [];
  const coinRegimes: Array<{ coin: string; regimeId: number; label: string; stable: boolean }> = [];
  const regimeCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };

  // Funnel counters for diagnostics
  let countNeutral = 0;
  let countVol = 0;
  let countSpread = 0;
  let countFunding = 0;
  let countRR = 0;
  let countScore = 0;

  // Use batchSize of 5 and inter-batch delay to stay robust against rate-limits
  const batchSize = 5;
  for (let idx = 0; idx < universe.length; idx += batchSize) {
    const batch = universe.slice(idx, idx + batchSize);
    
    await Promise.all(
      batch.map(async coinTicker => {
        const symbol = coinTicker.symbol;
        const livePrice = getLivePrice(symbol);
        const currentPrice = livePrice ? livePrice.markPrice : parseFloat(coinTicker.lastPrice);
        const bidPrice = livePrice ? livePrice.bidPrice : parseFloat(coinTicker.bidPrice || currentPrice);
        const askPrice = livePrice ? livePrice.askPrice : parseFloat(coinTicker.askPrice || currentPrice);
        
        try {
          // Fetch 1D klines via cache (60 min age)
          const d1Klines = await getCachedKlines1D(symbol);
          if (d1Klines.length < 200) {
            console.log(`[DEBUG-SERVER] Skip ${symbol}: Klines 1D kurang dari 200 (ada ${d1Klines.length})`);
            return;
          }

          // Fetch 4H klines via cache (30 min age)
          const h4Klines = await getCachedKlines4H(symbol);
          if (h4Klines.length < 200) {
            console.log(`[DEBUG-SERVER] Skip ${symbol}: Klines 4H kurang dari 200 (ada ${h4Klines.length})`);
            return;
          }

          // Fetch 15M klines (limit=250) - polling freshly each scan cycle with retry and rate check
          const m15Klines = await fetchBinanceWithRetry(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=250`);
          if (m15Klines.length < 30) {
            console.log(`[DEBUG-SERVER] Skip ${symbol}: Klines 15M kurang dari 30 (ada ${m15Klines.length})`);
            return;
          }

          // Parse closes, highs, lows, volumes
          const d1Closes = d1Klines.map((k: any) => parseFloat(k[4]));
          const h4Closes = h4Klines.map((k: any) => parseFloat(k[4]));
          const h4Highs = h4Klines.map((k: any) => parseFloat(k[2]));
          const h4Lows = h4Klines.map((k: any) => parseFloat(k[3]));
          const h4Volumes = h4Klines.map((k: any) => parseFloat(k[5]));

          const m15Closes = m15Klines.map((k: any) => parseFloat(k[4]));
          const m15Highs = m15Klines.map((k: any) => parseFloat(k[2]));
          const m15Lows = m15Klines.map((k: any) => parseFloat(k[3]));
          const m15Volumes = m15Klines.map((k: any) => parseFloat(k[5]));
          const m15TakerBuyVolumes = m15Klines.map((k: any) => parseFloat(k[9]));

          // Calculate 15M Volume Spike
          const last20Vols = m15Volumes.slice(m15Volumes.length - 21, m15Volumes.length - 1);
          const avgVol20 = last20Vols.reduce((s, v) => s + v, 0) / 20;
          const currentVol = m15Volumes[m15Volumes.length - 1];
          const volumeSpike = avgVol20 > 0 ? (currentVol / avgVol20) * 100 : 0;

          const m15Rsi = calculateRSI(m15Closes, 14);
          const m15RsiLast = m15Rsi[m15Rsi.length - 1];

          // Calculate spread and fetch order book depth early
          const spread = ((askPrice - bidPrice) / bidPrice) * 100;
          let bidAskRatio = 1.0;
          try {
            const depth = await fetchBinanceWithRetry(`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=20`);
            if (depth && depth.bids) {
              const bidSum = depth.bids.reduce((sum: number, b: any) => sum + parseFloat(b[1]), 0);
              const askSum = depth.asks.reduce((sum: number, a: any) => sum + parseFloat(a[1]), 0);
              bidAskRatio = askSum > 0 ? bidSum / askSum : 1.0;
            }
          } catch (depthErr) {
            console.warn(`[Market Scan] Early depth fetch warning for ${symbol}:`, depthErr);
          }

          // ==========================================
          // 1. REGIME CLASSIFICATION LAYER (FIRST LAYER)
          // ==========================================
          const regimeEval = evaluateMarketRegime(
            d1Closes,
            h4Highs,
            h4Lows,
            h4Closes,
            h4Volumes,
            m15RsiLast,
            m15Closes,
            m15Highs,
            m15Lows,
            volumeSpike,
            m15Volumes,
            spread,
            bidAskRatio,
            m15TakerBuyVolumes
          );

          // Track regime counts and list for snapshot overview
          coinRegimes.push({
            coin: symbol,
            regimeId: regimeEval.id,
            label: regimeEval.label,
            stable: regimeEval.stable,
          });
          regimeCounts[regimeEval.id] = (regimeCounts[regimeEval.id] || 0) + 1;

          // Check if tradeable under this regime and settings
          const isNeutral = regimeEval.id === 5;
          // For high-momentum scalp regimes (1, 2, 6, 8), we do not enforce stability so we can catch fresh breakouts!
          const isUnstable = !regimeEval.stable && ![1, 2, 6, 8].includes(regimeEval.id);
          const isRangeDisabled = regimeEval.id === 4 && !settings.allowRangeTrading;

          if (isNeutral || isUnstable || isRangeDisabled) {
            countNeutral++;
            // Stop processing further filters, do not calculate score, save as NO TRADE
            const noTradeReason = regimeEval.label === '🚫 ILLIQUID / SPREAD LEBAR'
              ? 'REZIM TIDAK LIKUID - SPREAD LEBAR/DEPTH NIPIS'
              : isNeutral 
              ? "REGIME NEUTRAL - NO TRADE" 
              : isUnstable 
              ? "REGIME TRANSITION - UNCONFIRMED" 
              : "REGIME RANGE - BREAKOUTS DISABLED";

            console.log(`[DEBUG-SERVER] Coin ${symbol} disekat oleh Regime Classification Layer: ${noTradeReason} (Regime ID: ${regimeEval.id}, Stable: ${regimeEval.stable})`);

            const noTradeSignal: Signal = {
              id: `${symbol}_NOTRADE_${Date.now()}`,
              coin: symbol,
              direction: 'LONG',
              timestamp: Date.now(),
              entryPrice: currentPrice,
              stopLoss: currentPrice,
              takeProfit1: currentPrice,
              takeProfit2: currentPrice,
              takeProfit3: currentPrice,
              score: 0,
              outcome: 'EXPIRED', // does not stay pending
              metrics: {
                trend1D: regimeEval.trend1D,
                trend4H: regimeEval.trend4H,
                trendAlign: regimeEval.trend1D === regimeEval.trend4H && regimeEval.trend1D !== 'NEUTRAL',
                rsi4H: 0,
                rsi15M: m15RsiLast,
                macdHistogram: [0, 0, 0],
                macdAlign: false,
                volumeSpike,
                cvdDelta10: 0,
                cvdAlign: false,
                bidAskRatio: bidAskRatio,
                spread: spread,
                fundingRate: 0,
                openInterestChange: 0,
              },
              scoreBreakdown: { trend: 0, momentum: 0, volume: 0, probability: 0, liquidity: 0 },
              regimeId: regimeEval.id,
              regimeLabel: regimeEval.label,
              regimeStable: regimeEval.stable,
              noTrade: true,
              noTradeReason,
            };
            validSignals.push(noTradeSignal);
            return; // EXIT Pipeline
          }

          // Determine Direction allowed by the tradeable regime
          let direction: 'LONG' | 'SHORT' = 'LONG';
          if ([6, 7, 8].includes(regimeEval.id)) {
            direction = 'SHORT';
          } else if (regimeEval.id === 4) {
            direction = (currentPrice - regimeEval.support) < (regimeEval.resistance - currentPrice) ? 'LONG' : 'SHORT';
          }

          // Standard scan indicators needed for filters/scoring
          const h4Rsi = calculateRSI(h4Closes, 14);
          const h4RsiLast = h4Rsi[h4Rsi.length - 1];

          let rsiOptimum = false;
          if (direction === 'LONG' && m15RsiLast >= 45 && m15RsiLast <= 68) {
            rsiOptimum = true;
          } else if (direction === 'SHORT' && m15RsiLast >= 32 && m15RsiLast <= 55) {
            rsiOptimum = true;
          }

          const m15Macd = calculateMACD(m15Closes, 12, 26, 9);
          const hist = m15Macd.histogram;
          const histLast = hist[hist.length - 1];
          const histPrev1 = hist[hist.length - 2];
          const histPrev2 = hist[hist.length - 3];

          let macdAlign = false;
          if (direction === 'LONG') {
            if (histLast > 0 && histLast > histPrev1 && histPrev1 > histPrev2) {
              macdAlign = true;
            }
          } else {
            if (histLast < 0 && histLast < histPrev1 && histPrev1 < histPrev2) {
              macdAlign = true;
            }
          }

          const m15Atr = calculateATR(m15Highs, m15Lows, m15Closes, 14);
          const atrLast = m15Atr[m15Atr.length - 1] || (currentPrice * 0.015);

          const h4AtrList = calculateATR(h4Highs, h4Lows, h4Closes, 14);
          const atr4HLast = h4AtrList[h4AtrList.length - 1] || (currentPrice * 0.02);

          // Hard Gate 3: Volume Spike condition based on regime
          if (regimeEval.id === 2 || regimeEval.id === 6) {
            if (volumeSpike < settings.minVolumeSpike) {
              countVol++;
              console.log(`[DEBUG-SERVER] REJECT ${symbol} (Expansion): volumeSpike (${volumeSpike.toFixed(1)}%) kurang daripada minVolumeSpike (${settings.minVolumeSpike}%)`);
              return;
            }
          } else if (regimeEval.id === 3 || regimeEval.id === 7) {
            // Pullback Trend: volumeSpike must be within a healthy pullback range (40% to 350%)
            if (volumeSpike < 40 || volumeSpike > 350) {
              countVol++;
              console.log(`[DEBUG-SERVER] REJECT ${symbol} (Pullback): volumeSpike (${volumeSpike.toFixed(1)}%) di luar julat tenang/pullback (40%-350%)`);
              return;
            }
          }

          let cvdDelta10 = 0;
          for (let i = m15Closes.length - 10; i < m15Closes.length; i++) {
            const v = m15Volumes[i];
            const tb = m15TakerBuyVolumes[i];
            const ts = v - tb;
            cvdDelta10 += tb - ts;
          }
          const cvdAlign = direction === 'LONG' ? cvdDelta10 > 0 : cvdDelta10 < 0;

          // Hard Gate 4: Spread <= 0.15%
          if (spread > 0.15) {
            countSpread++;
            console.log(`[DEBUG-SERVER] REJECT ${symbol}: spread (${spread.toFixed(3)}%) melebihi had 0.15%`);
            return;
          }

          const fundingRate = fundingRateMap.get(symbol) || 0;
          // Hard Gate 5: Funding rate limits
          if (direction === 'LONG' && fundingRate > 0.05) {
            countFunding++;
            console.log(`[DEBUG-SERVER] REJECT ${symbol}: fundingRate LONG (${fundingRate.toFixed(3)}) melebihi had 0.05`);
            return;
          }
          if (direction === 'SHORT' && fundingRate < -0.05) {
            countFunding++;
            console.log(`[DEBUG-SERVER] REJECT ${symbol}: fundingRate SHORT (${fundingRate.toFixed(3)}) kurang daripada had -0.05`);
            return;
          }

          // ==========================================
          // 4. REGIME-SPECIFIC TP / SL CALCULATION (SCALPER ADJUSTED)
          // ==========================================
          let stopLoss = 0;
          let takeProfit1 = 0;
          let takeProfit2 = 0;
          let takeProfit3 = 0;

          // Get swing structure reference on M15 for tight scalp parameters
          const swingResM15 = getSwingStructure(m15Highs, m15Lows);

          // Pullback Support/Resistance EMA 15M
          const m15Ema50 = calculateEMA(m15Closes, 50);
          const m15Ema200 = calculateEMA(m15Closes, 200);
          const m15Ema50Last = m15Ema50[m15Ema50.length - 1] || currentPrice;
          const m15Ema200Last = m15Ema200[m15Ema200.length - 1] || currentPrice;

          if (regimeEval.id === 1) { // Strong Uptrend (Scalper)
            stopLoss = Math.max(swingResM15.latestSwingLow, currentPrice - 2.5 * atrLast);
            if (stopLoss >= currentPrice || stopLoss <= 0) {
              stopLoss = currentPrice * 0.995;
            }
            let slDistance = Math.abs(currentPrice - stopLoss);
            if (slDistance < currentPrice * 0.0015) {
              slDistance = currentPrice * 0.003;
              stopLoss = currentPrice - slDistance;
            } else if (slDistance > currentPrice * 0.012) {
              slDistance = currentPrice * 0.012;
              stopLoss = currentPrice - slDistance;
            }
            const dynamicTP1 = currentPrice + (settings.minRR * slDistance);
            takeProfit1 = Math.min(dynamicTP1, currentPrice * 1.03);
            takeProfit2 = takeProfit1 + 0.8 * slDistance;
            takeProfit3 = takeProfit1 + 1.8 * slDistance;

          } else if (regimeEval.id === 2) { // Uptrend Expansion / Breakout (Scalper)
            stopLoss = currentPrice - 1.5 * atrLast;
            let slDistance = Math.abs(currentPrice - stopLoss);
            if (slDistance < currentPrice * 0.0015) {
              slDistance = currentPrice * 0.003;
              stopLoss = currentPrice - slDistance;
            } else if (slDistance > currentPrice * 0.012) {
              slDistance = currentPrice * 0.012;
              stopLoss = currentPrice - slDistance;
            }
            takeProfit1 = currentPrice + (settings.minRR * slDistance);
            takeProfit2 = takeProfit1 + 0.8 * slDistance;
            takeProfit3 = takeProfit1 + 1.8 * slDistance;

          } else if (regimeEval.id === 3) { // Pullback Trend (Scalper)
            const supportEMA = Math.min(m15Ema50Last, m15Ema200Last);
            stopLoss = supportEMA - 0.2 * atrLast;
            if (stopLoss >= currentPrice || stopLoss <= 0) {
              stopLoss = currentPrice - 1.5 * atrLast;
            }
            let slDistance = Math.abs(currentPrice - stopLoss);
            if (slDistance < currentPrice * 0.0015) {
              slDistance = currentPrice * 0.003;
              stopLoss = currentPrice - slDistance;
            } else if (slDistance > currentPrice * 0.012) {
              slDistance = currentPrice * 0.012;
              stopLoss = currentPrice - slDistance;
            }
            const minTP1 = currentPrice + (settings.minRR * slDistance);
            takeProfit1 = (swingResM15.latestSwingHigh > minTP1) ? swingResM15.latestSwingHigh : minTP1;
            takeProfit2 = takeProfit1 + 0.8 * slDistance;
            takeProfit3 = takeProfit1 + 1.8 * slDistance;

          } else if (regimeEval.id === 4) { // Range (Scalper)
            const rangeMid = regimeEval.midpoint;
            if (direction === 'LONG') {
              takeProfit1 = rangeMid;
              takeProfit2 = regimeEval.resistance;
              takeProfit3 = regimeEval.resistance * 1.002;
              stopLoss = regimeEval.support * 0.998;
            } else {
              takeProfit1 = rangeMid;
              takeProfit2 = regimeEval.support;
              takeProfit3 = regimeEval.support * 0.998;
              stopLoss = regimeEval.resistance * 1.002;
            }

          } else if (regimeEval.id === 6) { // Bearish Expansion / Breakdown (Scalper)
            stopLoss = currentPrice + 1.5 * atrLast;
            let slDistance = Math.abs(currentPrice - stopLoss);
            if (slDistance < currentPrice * 0.0015) {
              slDistance = currentPrice * 0.003;
              stopLoss = currentPrice + slDistance;
            } else if (slDistance > currentPrice * 0.012) {
              slDistance = currentPrice * 0.012;
              stopLoss = currentPrice + slDistance;
            }
            takeProfit1 = currentPrice - (settings.minRR * slDistance);
            takeProfit2 = takeProfit1 - 0.8 * slDistance;
            takeProfit3 = takeProfit1 - 1.8 * slDistance;

          } else if (regimeEval.id === 7) { // Pullback Short (Scalper)
            const resistanceEMA = Math.max(m15Ema50Last, m15Ema200Last);
            stopLoss = resistanceEMA + 0.2 * atrLast;
            if (stopLoss <= currentPrice || stopLoss <= 0) {
              stopLoss = currentPrice + 1.5 * atrLast;
            }
            let slDistance = Math.abs(currentPrice - stopLoss);
            if (slDistance < currentPrice * 0.0015) {
              slDistance = currentPrice * 0.003;
              stopLoss = currentPrice + slDistance;
            } else if (slDistance > currentPrice * 0.012) {
              slDistance = currentPrice * 0.012;
              stopLoss = currentPrice + slDistance;
            }
            const minTP1 = currentPrice - (settings.minRR * slDistance);
            takeProfit1 = (swingResM15.latestSwingLow < minTP1) ? swingResM15.latestSwingLow : minTP1;
            takeProfit2 = takeProfit1 - 0.8 * slDistance;
            takeProfit3 = takeProfit1 - 1.8 * slDistance;

          } else if (regimeEval.id === 8) { // Strong Downtrend (Scalper)
            stopLoss = Math.min(swingResM15.latestSwingHigh, currentPrice + 2.5 * atrLast);
            if (stopLoss <= currentPrice || stopLoss <= 0) {
              stopLoss = currentPrice * 1.005;
            }
            let slDistance = Math.abs(currentPrice - stopLoss);
            if (slDistance < currentPrice * 0.0015) {
              slDistance = currentPrice * 0.003;
              stopLoss = currentPrice + slDistance;
            } else if (slDistance > currentPrice * 0.012) {
              slDistance = currentPrice * 0.012;
              stopLoss = currentPrice + slDistance;
            }
            const dynamicTP1 = currentPrice - (settings.minRR * slDistance);
            takeProfit1 = Math.max(dynamicTP1, currentPrice * 0.97);
            takeProfit2 = takeProfit1 - 0.8 * slDistance;
            takeProfit3 = takeProfit1 - 1.8 * slDistance;
          }

          // Safety bounds
          if (stopLoss <= 0) {
            stopLoss = direction === 'LONG' ? currentPrice * 0.99 : currentPrice * 1.01;
          }
          if (takeProfit1 <= 0 || (direction === 'LONG' && takeProfit1 <= currentPrice) || (direction === 'SHORT' && takeProfit1 >= currentPrice)) {
            takeProfit1 = direction === 'LONG' ? currentPrice * 1.01 : currentPrice * 0.99;
            takeProfit2 = direction === 'LONG' ? currentPrice * 1.02 : currentPrice * 0.98;
            takeProfit3 = direction === 'LONG' ? currentPrice * 1.03 : currentPrice * 0.97;
          }

          // Hard Gate 2 & 11: Risk/Reward check
          const entryToSL = Math.abs(currentPrice - stopLoss);
          const entryToTP1 = Math.abs(takeProfit1 - currentPrice);
          const computedRR = entryToSL > 0 ? entryToTP1 / entryToSL : 0;
          const minRequiredRR = settings.minRR;

          if (computedRR < minRequiredRR) {
            countRR++;
            console.log(`[DEBUG-SERVER] REJECT ${symbol}: Nisbah Risk/Reward (${computedRR.toFixed(2)}) kurang daripada had minimum ${minRequiredRR} (SL: ${stopLoss}, TP1: ${takeProfit1}, Entry: ${currentPrice})`);
            return; // REJECT instantly if RR is not satisfied
          }

          // Fetch Open Interest ONLY for qualifying candidates
          let openInterestChange = 0.0;

          try {
            const oiHistRes = await fetch(`https://fapi.binance.com/fapi/v1/openInterestHist?symbol=${symbol}&period=15m&limit=5`);
            if (oiHistRes.ok) {
              const oiHist = await oiHistRes.json();
              if (oiHist.length >= 2) {
                const latestOI = parseFloat(oiHist[oiHist.length - 1].sumOpenInterest);
                const prevOI = parseFloat(oiHist[oiHist.length - 2].sumOpenInterest);
                openInterestChange = prevOI > 0 ? ((latestOI - prevOI) / prevOI) * 100 : 0;
              }
            }
          } catch (depthErr) {
            console.warn(`[Market Scan] Depth/OI fetch warning for ${symbol}:`, depthErr);
          }

          // ==========================================
          // 5. REGIME-SPECIFIC SCORING CALCULATIONS
          // ==========================================
          let finalScore = 0;
          let breakdown = { trend: 0, momentum: 0, volume: 0, probability: 0, liquidity: 0 };

          if (regimeEval.id === 4) {
            // SPECIFIC SCORING FOR RANGE REGIME
            const distMid = Math.abs(currentPrice - regimeEval.midpoint);
            const halfHeight = (regimeEval.resistance - regimeEval.support) / 2;
            const positionScore = halfHeight > 0 ? (distMid / halfHeight) * 40 : 0;

            const rangeClarityScore = Math.min(30, (regimeEval.touches / 6) * 30);

            let volumeScoreRange = 10;
            const isNearBoundary = (distMid / halfHeight) > 0.5;
            if (!isNearBoundary && volumeSpike < 120) {
              volumeScoreRange = 20;
            } else if (isNearBoundary && volumeSpike >= 120) {
              volumeScoreRange = 20;
            }

            let liquidityScore = 0;
            liquidityScore += Math.max(0, 5 - (spread / 0.05) * 5);
            const oiConfirms = (direction === 'LONG' && openInterestChange > 0) || (direction === 'SHORT' && openInterestChange > 0);
            if (oiConfirms) liquidityScore += 5;

            finalScore = Math.min(100, Math.round(positionScore + rangeClarityScore + volumeScoreRange + liquidityScore));
            breakdown = {
              trend: Math.round(positionScore),
              momentum: Math.round(rangeClarityScore),
              volume: Math.round(volumeScoreRange),
              probability: 0,
              liquidity: Math.round(liquidityScore),
            };
          } else {
            // STANDARD SCORING FOR TRENDING/PULLBACK REGIMES
            // 1. Trend Score (30 pts)
            const d1Ema50 = calculateEMA(d1Closes, 50);
            const h4Ema50 = calculateEMA(h4Closes, 50);
            const d1Ema50Last = d1Ema50[d1Ema50.length - 1];
            const h4Ema50Last = h4Ema50[h4Ema50.length - 1];
            const d1Dist = Math.abs(currentPrice - d1Ema50Last) / d1Ema50Last;
            const h4Dist = Math.abs(currentPrice - h4Ema50Last) / h4Ema50Last;
            const trendScore = Math.min(15, d1Dist * 400) + Math.min(15, h4Dist * 400);

            // 2. Momentum Score (25 pts)
            let momentumScore = 0;
            if (rsiOptimum) momentumScore += 10;
            if (macdAlign) momentumScore += 10;
            const isConsistentlyIncreasing = histLast > histPrev1 && histPrev1 > histPrev2;
            const isConsistentlyDecreasing = histLast < histPrev1 && histPrev1 < histPrev2;
            if ((direction === 'LONG' && isConsistentlyIncreasing) || (direction === 'SHORT' && isConsistentlyDecreasing)) {
              momentumScore += 5;
            }

            // 3. Volume Score (20 pts)
            let volumeScore = 0;
            volumeScore += Math.min(10, (volumeSpike / 300) * 10);
            if (cvdAlign) volumeScore += 10;

            // 4. Probability Score (15 pts)
            const prob = await getProbabilityScore(direction, true, volumeSpike >= settings.minVolumeSpike, settings.minSampleSize);
            const probabilityScore = prob.score;

            // 5. Liquidity Score (10 pts)
            let liquidityScore = 0;
            liquidityScore += Math.max(0, 5 - (spread / 0.05) * 5);
            const oiConfirms = (direction === 'LONG' && openInterestChange > 0) || (direction === 'SHORT' && openInterestChange > 0);
            if (oiConfirms) liquidityScore += 5;

            finalScore = Math.min(100, Math.round(trendScore + momentumScore + volumeScore + probabilityScore + liquidityScore));
            breakdown = {
              trend: Math.round(trendScore),
              momentum: Math.round(momentumScore),
              volume: Math.round(volumeScore),
              probability: Math.round(probabilityScore),
              liquidity: Math.round(liquidityScore),
            };
          }

          const metricsObj: SignalMetrics = {
            trend1D: regimeEval.trend1D,
            trend4H: regimeEval.trend4H,
            trendAlign: regimeEval.trend1D === regimeEval.trend4H && regimeEval.trend1D !== 'NEUTRAL',
            rsi4H: h4RsiLast,
            rsi15M: m15RsiLast,
            macdHistogram: hist.slice(hist.length - 5),
            macdAlign,
            volumeSpike,
            cvdDelta10,
            cvdAlign,
            bidAskRatio,
            spread,
            fundingRate,
            openInterestChange,
          };

          const probInfo = await getProbabilityScore(direction, true, volumeSpike >= settings.minVolumeSpike, settings.minSampleSize);

          const signalData: Signal = {
            id: `${symbol}_${direction}_${Date.now()}`,
            coin: symbol,
            direction,
            timestamp: Date.now(),
            entryPrice: currentPrice,
            stopLoss,
            takeProfit1,
            takeProfit2,
            takeProfit3,
            score: finalScore,
            outcome: 'PENDING',
            metrics: metricsObj,
            scoreBreakdown: breakdown,
            sampleSize: probInfo.sampleSize,
            winRateHistorical: probInfo.winRate,
            regimeId: regimeEval.id,
            regimeLabel: regimeEval.label,
            regimeStable: regimeEval.stable,
          };

          if (finalScore >= settings.minScore) {
            const validation = SignalSchema.safeParse({
              coin: signalData.coin,
              direction: signalData.direction,
              score: signalData.score,
              entryPrice: signalData.entryPrice,
            });
            if (validation.success) {
              logger.info({ symbol, score: finalScore }, 'Signal qualified');
              validSignals.push(signalData);
            } else {
              logger.error({ error: validation.error, symbol }, 'Signal failed validation schema');
            }
          } else {
            countScore++;
            console.log(`[DEBUG-SERVER] REJECT ${symbol}: Score ${finalScore} kurang daripada minScore (${settings.minScore})`);
          }
        } catch (err: any) {
          if (err.message && err.message.includes('SYMBOL_NOT_EXIST')) {
            console.warn(`[Market Scan] Simbol ${symbol} tidak wujud di Binance (HTTP 400). Ditambah ke senarai langkau.`);
            nonExistentSymbols.add(symbol);
          } else {
            logger.error({ error: err.message || err, symbol }, 'Failed to process symbol');
          }
        }
      })
    );
    // Add protective delay of 400ms between batches to stay safe with Binance Futures API weight
    await sleep(400);
  }

  // Rank by Score descending
  validSignals.sort((a, b) => b.score - a.score);

  // Run AI Debate Layer on candidates
  try {
    await runAIDebateLayer(validSignals, db);
  } catch (debateErr) {
    console.error('[Market Scan] AI Debate Layer error:', debateErr);
  }

  // Generate Gemini Narratives for Top 3 A+ signals (Must Follow, score >= 90)
  const topAPlus = validSignals.filter(s => s.score >= 90 && !s.noTrade && !(s as any).disputedByDebate).slice(0, 3);
  for (const sig of topAPlus) {
    sig.narrative = await generateNarrative(sig.coin, sig.direction, sig.metrics);
  }

  // Save new signals to Firestore - only save real tradeable signals!
  for (const sig of validSignals) {
    if (!sig.noTrade) {
      await db.collection('signals_history').doc(sig.id).set(sig);
    }
  }

  // Update market summary metrics snapshot
  const tradeableSignals = validSignals.filter(s => !s.noTrade);
  const btcTrendInfo = await getBtcTrend();
  const bullishCount = tradeableSignals.filter(s => s.direction === 'LONG').length;
  const marketSentiment = tradeableSignals.length > 0 ? (bullishCount / tradeableSignals.length) * 100 : 50;

  // Altcoin Strength Index: % altcoins trend aligned with BTC
  const mappedBtcDir = btcTrendInfo === 'BULLISH' ? 'LONG' : btcTrendInfo === 'BEARISH' ? 'SHORT' : null;
  const btcAlignCount = tradeableSignals.filter(s => s.direction === mappedBtcDir).length;
  const altcoinStrengthIndex = tradeableSignals.length > 0 ? (btcAlignCount / tradeableSignals.length) * 100 : 50;

  const marketStatusDoc: MarketStatus = {
    btcTrend: btcTrendInfo,
    marketSentiment,
    altcoinStrengthIndex,
    activeSignalsCount: tradeableSignals.length,
    strongSignalsCount: topAPlus.length,
    lastScanTime: Date.now(),
    regimeCounts,
    coinRegimes,
  };

  await db.collection('market_snapshot').doc('latest').set(marketStatusDoc);

  clearCaches();

  console.log(`[Funnel Summary] Total: ${universe.length} | Regime NEUTRAL/RANGE/Unstable: ${countNeutral} | Reject VolumeSpike: ${countVol} | Reject Spread: ${countSpread} | Reject FundingRate: ${countFunding} | Reject RR: ${countRR} | Reject Score<min: ${countScore} | LULUS SEMUA (Tradeable): ${tradeableSignals.length}`);
  console.log(`[Market Scan] Finished scanning. Found ${tradeableSignals.length} qualified trade signals, and ${validSignals.filter(s => s.noTrade).length} NO TRADE regimes.`);
  return validSignals;
}

// BTC Trend helper
async function getBtcTrend(): Promise<'BULLISH' | 'BEARISH' | 'NEUTRAL'> {
  try {
    const d1Klines = await getCachedKlines1D('BTCUSDT');
    const h4Klines = await getCachedKlines4H('BTCUSDT');

    const d1Closes = d1Klines.map((k: any) => parseFloat(k[4]));
    const h4Closes = h4Klines.map((k: any) => parseFloat(k[4]));

    const btcPrice = d1Closes[d1Closes.length - 1];

    const d1Ema50 = calculateEMA(d1Closes, 50);
    const d1Ema200 = calculateEMA(d1Closes, 200);
    const h4Ema50 = calculateEMA(h4Closes, 50);
    const h4Ema200 = calculateEMA(h4Closes, 200);

    const d1Ema50Last = d1Ema50[d1Ema50.length - 1];
    const d1Ema200Last = d1Ema200[d1Ema200.length - 1];
    const h4Ema50Last = h4Ema50[h4Ema50.length - 1];
    const h4Ema200Last = h4Ema200[h4Ema200.length - 1];

    const d1Bullish = d1Ema50Last > d1Ema200Last && btcPrice > d1Ema50Last;
    const d1Bearish = d1Ema50Last < d1Ema200Last && btcPrice < d1Ema50Last;

    const h4Bullish = h4Ema50Last > h4Ema200Last && h4Closes[h4Closes.length - 1] > h4Ema50Last;
    const h4Bearish = h4Ema50Last < h4Ema200Last && h4Closes[h4Closes.length - 1] < h4Ema50Last;

    if (d1Bullish && h4Bullish) return 'BULLISH';
    if (d1Bearish && h4Bearish) return 'BEARISH';
    return 'NEUTRAL';
  } catch (err) {
    return 'NEUTRAL';
  }
}

// ==========================================
// API ROUTES
// ==========================================

// GET Performance & Cumulative R-Multiple Backtest stats
app.get('/api/performance', async (req, res) => {
  const cached = appCache.get('performance');
  if (cached) {
    return res.json(cached);
  }
  try {
    const settings = await getSettings();
    const minRR = settings.minRR || 1.5;

    const snapshot = await db.collection('signals_history').orderBy('timestamp', 'asc').get();
    const signals = snapshot.docs.map(doc => doc.data() as Signal);

    const finished = signals.filter(s => s.outcome === 'WIN' || s.outcome === 'LOSS');
    const totalSignals = finished.length;

    const wins = finished.filter(s => s.outcome === 'WIN').length;
    const winRateOverall = totalSignals > 0 ? (wins / totalSignals) * 100 : 0;

    // By Band
    const aPlus = finished.filter(s => s.score >= 90);
    const winRateAPlus = aPlus.length > 0 ? (aPlus.filter(s => s.outcome === 'WIN').length / aPlus.length) * 100 : 0;

    const aSignals = finished.filter(s => s.score >= 80 && s.score < 90);
    const winRateA = aSignals.length > 0 ? (aSignals.filter(s => s.outcome === 'WIN').length / aSignals.length) * 100 : 0;

    const bSignals = finished.filter(s => s.score >= 70 && s.score < 80);
    const winRateB = bSignals.length > 0 ? (bSignals.filter(s => s.outcome === 'WIN').length / bSignals.length) * 100 : 0;

    // Cumulative R-multiple calculation based on actual dynamic RR
    let cumulativeR = 0;
    let totalWinRR = 0;
    let winCount = 0;

    const equityCurve = finished.map(s => {
      let individualRR = minRR;
      if (s.entryPrice && s.stopLoss && s.takeProfit1) {
        const slDist = Math.abs(s.entryPrice - s.stopLoss);
        const tpDist = Math.abs(s.takeProfit1 - s.entryPrice);
        if (slDist > 0) {
          individualRR = tpDist / slDist;
        }
      }

      if (s.outcome === 'WIN') {
        cumulativeR += individualRR;
        totalWinRR += individualRR;
        winCount++;
      } else if (s.outcome === 'LOSS') {
        cumulativeR -= 1.0;
      }
      return {
        timestamp: s.timestamp,
        rMultiple: parseFloat(cumulativeR.toFixed(2)),
      };
    });

    const avgRRRealized = winCount > 0 ? parseFloat((totalWinRR / winCount).toFixed(1)) : parseFloat(minRR.toFixed(1));

    const result = {
      totalSignals,
      winRateOverall: parseFloat(winRateOverall.toFixed(1)),
      winRateAPlus: parseFloat(winRateAPlus.toFixed(1)),
      winRateA: parseFloat(winRateA.toFixed(1)),
      winRateB: parseFloat(winRateB.toFixed(1)),
      avgRRRealized,
      equityCurve,
    };

    appCache.set('performance', result);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET Settings
app.get('/api/settings', async (req, res) => {
  const settings = await getSettings();
  res.json(settings);
});

// POST Settings Update
app.post('/api/settings', async (req, res) => {
  try {
    const newSettings = req.body as AppSettings;
    await db.collection('settings').doc('global').set(newSettings);
    clearCaches();
    res.json({ success: true, settings: newSettings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET Latest Signals
app.get('/api/signals', async (req, res) => {
  const cached = appCache.get('signals');
  if (cached) {
    return res.json(cached);
  }
  try {
    // Return all signals generated in the last 24 hours
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    const snapshot = await db.collection('signals_history')
      .where('timestamp', '>=', yesterday)
      .orderBy('timestamp', 'desc')
      .get();
    let list = snapshot.docs.map(doc => doc.data() as Signal);
    
    // 1. Programmatically filter out any persistent noTrade records from history
    list = list.filter(s => !s.noTrade);

    // 2. Load the latest market snapshot to inject current noTrade states in-memory
    const marketSnap = await db.collection('market_snapshot').doc('latest').get();
    if (marketSnap.exists) {
      const snapData = marketSnap.data() as MarketStatus;
      if (snapData.coinRegimes) {
        for (const cr of snapData.coinRegimes) {
          // Check if this coin already has a real active PENDING trade signal in the list
          const hasRealSignal = list.some(s => s.coin === cr.coin && s.outcome === 'PENDING');
          if (!hasRealSignal) {
            // Build a clean, dynamic, in-memory noTrade status representation for this coin
            const currentPrice = 0; // We keep it 0 as the UI handles it as "—"
            const noTradeSignal: Signal = {
              id: `${cr.coin}_NOTRADE_DYNAMIC`,
              coin: cr.coin,
              direction: 'LONG',
              timestamp: snapData.lastScanTime || Date.now(),
              entryPrice: currentPrice,
              stopLoss: currentPrice,
              takeProfit1: currentPrice,
              takeProfit2: currentPrice,
              takeProfit3: currentPrice,
              score: 0,
              outcome: 'EXPIRED',
              metrics: {
                trend1D: cr.regimeId <= 3 ? 'BULLISH' : cr.regimeId >= 6 ? 'BEARISH' : 'NEUTRAL',
                trend4H: cr.regimeId <= 3 ? 'BULLISH' : cr.regimeId >= 6 ? 'BEARISH' : 'NEUTRAL',
                trendAlign: false,
                rsi4H: 0,
                rsi15M: 0,
                macdHistogram: [0],
                macdAlign: false,
                volumeSpike: 0,
                cvdDelta10: 0,
                cvdAlign: false,
                bidAskRatio: 1.0,
                spread: 0,
                fundingRate: 0,
                openInterestChange: 0,
              },
              scoreBreakdown: { trend: 0, momentum: 0, volume: 0, probability: 0, liquidity: 0 },
              regimeId: cr.regimeId,
              regimeLabel: cr.label,
              regimeStable: cr.stable,
              noTrade: true,
              noTradeReason: `Tiada isyarat kemasukan dikesan. Pasaran berada dalam keadaan ${cr.label} (${cr.stable ? 'Stabil' : 'Transisi'}).`,
            };
            list.push(noTradeSignal);
          }
        }
      }
    }

    appCache.set('signals', list);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET Market Status
app.get('/api/market-status', async (req, res) => {
  try {
    const snap = await db.collection('market_snapshot').doc('latest').get();
    if (snap.exists) {
      res.json(snap.data() as MarketStatus);
    } else {
      res.json({
        btcTrend: 'NEUTRAL',
        marketSentiment: 50,
        altcoinStrengthIndex: 50,
        activeSignalsCount: 0,
        strongSignalsCount: 0,
        lastScanTime: 0,
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// TRIGGER Manual Scan Now (cooldown protected)
app.post('/api/scan-now', async (req, res) => {
  const now = Date.now();
  if (now - lastScanTime < COOLDOWN_MS) {
    const remaining = Math.round((COOLDOWN_MS - (now - lastScanTime)) / 1000);
    return res.status(429).json({ error: `Sila tunggu ${remaining} saat sebelum mengimbas semula.` });
  }

  try {
    lastScanTime = now;
    // Trigger outcome checks first to resolve any previous candles
    await updatePendingSignals();
    // Run core scan
    const signals = await runMarketScan();
    res.json({ success: true, signals });
  } catch (err: any) {
    console.error('Scan manual error:', err);
    res.status(500).json({ error: err.message });
  }
});

// SSE Live Price Stream Endpoint
app.get('/api/live-prices/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial cache snap
  const initialPrices = getAllLivePrices();
  res.write(`data: ${JSON.stringify(initialPrices)}\n\n`);

  const intervalId = setInterval(() => {
    const currentPrices = getAllLivePrices();
    res.write(`data: ${JSON.stringify(currentPrices)}\n\n`);
  }, 1000);

  req.on('close', () => {
    clearInterval(intervalId);
    res.end();
  });
});

// GET Historical Signal Logs
app.get('/api/historical-logs', async (req, res) => {
  const cached = appCache.get('historical-logs');
  if (cached) {
    return res.json(cached);
  }
  try {
    const snapshot = await db.collection('signals_history').orderBy('timestamp', 'desc').get();
    let list = snapshot.docs.map(doc => doc.data() as Signal);
    // Programmatically filter out any persistent noTrade records from historical logs
    list = list.filter(s => !s.noTrade);
    appCache.set('historical-logs', list);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// VITE OR STATIC FILE MIDDLEWARE
// ==========================================
async function startServer() {
  // 1. Mount Vite middleware in development or static folder in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // 2. Start listening immediately so the container's TCP probe passes and doesn't time out
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Crypto Scalper Server running on port ${PORT}`);

    // Initialize real-time WebSocket live feed
    try {
      startLiveFeed();
    } catch (wsErr) {
      console.error('[WebSocket Init] Failed to start live feed:', wsErr);
    }

    // 3. Kick off long-running database & scanning initialization tasks in the background
    (async () => {
      console.log('[Background Init] Starting database seeding and initial scan...');
      try {
        // Clear any leftover old persistent noTrade signals from previous buggy scans to clean up the DB
        console.log('[Background Init] Cleaning up old noTrade records from signals_history collection...');
        const badSnapshot = await db.collection('signals_history').where('noTrade', '==', true).get();
        if (!badSnapshot.empty) {
          console.log(`[Background Init] Found ${badSnapshot.docs.length} bad noTrade records. Deleting...`);
          for (const doc of badSnapshot.docs) {
            db.deleteDoc('signals_history', doc.id);
          }
          console.log('[Background Init] Cleaned up all bad noTrade records from signals_history.');
        } else {
          console.log('[Background Init] No bad noTrade records found.');
        }

        // Seed the DB if it has no data
        await seedDatabaseIfEmpty();

        // Run outcome updates initially on boot
        await updatePendingSignals();

        // Trigger initial scan to make sure UI is immediately filled with fresh signals!
        try {
          await runMarketScan();
        } catch (err) {
          console.error('[Background Init] Initial boot scan failed:', err);
        }
      } catch (err) {
        console.error('[Background Init] Background initialization error:', err);
      }
    })();
  });

  // Synchronized scan scheduler - check minutes every 10 seconds
  let lastCheckedCandleTime = 0;
  setInterval(async () => {
    const date = new Date();
    const minutes = date.getUTCMinutes();
    const seconds = date.getUTCSeconds();

    // Scan precisely on :00, :15, :30, :45 + 5s buffer
    if ([0, 15, 30, 45].includes(minutes) && seconds >= 5) {
      const currentCandleTime = Math.floor(date.getTime() / (15 * 60 * 1000)) * (15 * 60 * 1000);
      if (currentCandleTime > lastCheckedCandleTime) {
        lastCheckedCandleTime = currentCandleTime;
        console.log(`[Scheduler] 15M Close Close Sync triggered: ${date.toISOString()}`);
        try {
          await updatePendingSignals();
          await runMarketScan();
        } catch (err) {
          console.error('[Scheduler] Sync Scan error:', err);
        }
      }
    }
  }, 10000);

  // Separate interval for outcome updater to run every 5 minutes
  setInterval(async () => {
    await updatePendingSignals();
  }, 5 * 60 * 1000);
}

startServer();
