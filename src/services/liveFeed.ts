import WebSocket from 'ws';
import { FIXED_TRADE_PAIRS, MEME_COINS_WITH_1000_PREFIX } from '../config/pairs.js';

export interface LivePriceData {
  symbol: string;
  bidPrice: number;
  askPrice: number;
  markPrice: number;
  lastUpdated: number;
}

export const livePriceCache = new Map<string, LivePriceData>();

let ws: WebSocket | null = null;
let reconnectDelay = 1000;
let proactiveReconnectTimeout: NodeJS.Timeout | null = null;
let isShuttingDown = false;

export function getBybitSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (MEME_COINS_WITH_1000_PREFIX.includes(upper)) {
    return `1000${upper}`;
  }
  return upper;
}

export function getLivePrice(symbol: string): LivePriceData | null {
  const cached = livePriceCache.get(symbol);
  if (!cached) return null;
  if (Date.now() - cached.lastUpdated > 10000) {
    return null;
  }
  return cached;
}

export function getAllLivePrices(): LivePriceData[] {
  const now = Date.now();
  return Array.from(livePriceCache.values()).filter(p => now - p.lastUpdated <= 10000);
}

export function startLiveFeed() {
  if (isShuttingDown) return;

  console.log('[WebSocket] Initializing Bybit Linear USDT Perpetual WebSocket...');
  // Bybit WebSocket subscriptions must be UPPERCASE and use 1000-prefix for meme coins
  const symbols = FIXED_TRADE_PAIRS.map(pair => getBybitSymbol(pair).toUpperCase());

  try {
    ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');

    ws.on('open', () => {
      console.log('[WebSocket] Connected to Bybit Linear USDT. Subscribing to channels...');
      reconnectDelay = 1000;

      const subscriptions = [];
      
      for (const symbol of symbols) {
        subscriptions.push({ op: 'subscribe', args: [`tickers.${symbol}`] });
      }
      
      for (const symbol of symbols) {
        subscriptions.push({ op: 'subscribe', args: [`orderbook.50.${symbol}`] });
      }
      
      for (const symbol of symbols) {
        subscriptions.push({ op: 'subscribe', args: [`publicTrade.${symbol}`] });
      }

      subscriptions.forEach(sub => {
        ws?.send(JSON.stringify(sub));
      });

      if (proactiveReconnectTimeout) clearTimeout(proactiveReconnectTimeout);
      proactiveReconnectTimeout = setTimeout(() => {
        console.log('[WebSocket] Performing proactive 23.5-hour scheduled reconnection...');
        ws?.close();
      }, 23.5 * 60 * 60 * 1000);
    });

    ws.on('message', (messageData: WebSocket.Data) => {
      try {
        const raw = messageData.toString();
        const msg = JSON.parse(raw);

        if (msg.op === 'subscribe' || msg.op === 'pong') {
          return;
        }

        if (msg.topic && msg.data) {
          const topic = msg.topic;
          const data = msg.data;

          // Support alphanumeric symbols like AI16ZUSDT and leading multiplier numbers like 1000PEPEUSDT
          const symbolMatch = topic.match(/([A-Z0-9]+USDT)/);
          if (!symbolMatch) return;

          let symbol = symbolMatch[1];
          symbol = symbol.replace(/^\d+/, ''); // Remove multiplier prefix to map back to our internal symbol (e.g. 1000PEPEUSDT -> PEPEUSDT)
          let cached = livePriceCache.get(symbol);
          if (!cached) {
            cached = {
              symbol,
              bidPrice: 0,
              askPrice: 0,
              markPrice: 0,
              lastUpdated: Date.now(),
            };
          }

          if (topic.startsWith('tickers.')) {
            cached.bidPrice = parseFloat(data.bidPrice || data.bid1Price || 0);
            cached.askPrice = parseFloat(data.askPrice || data.ask1Price || 0);
            cached.markPrice = parseFloat(data.markPrice || data.lastPrice || 0);
          } 
          else if (topic.startsWith('orderbook.')) {
            if (data.b && data.b.length > 0) {
              cached.bidPrice = parseFloat(data.b[0][0]);
            }
            if (data.a && data.a.length > 0) {
              cached.askPrice = parseFloat(data.a[0][0]);
            }
            if (!cached.markPrice || cached.markPrice === 0) {
              cached.markPrice = (cached.bidPrice + cached.askPrice) / 2;
            }
          } 
          else if (topic.startsWith('publicTrade.')) {
            if (data.p && (!cached.markPrice || cached.markPrice === 0)) {
              cached.markPrice = parseFloat(data.p);
            }
          }

          cached.lastUpdated = Date.now();
          livePriceCache.set(symbol, cached);
        }
      } catch (err) {
        if ((err as any).message?.includes('JSON')) {
          return;
        }
      }
    });

    ws.on('ping', (data) => {
      ws?.pong(data);
    });

    ws.on('close', (code, reason) => {
      if (isShuttingDown) return;
      console.log(`[WebSocket] Bybit connection closed. Reconnecting...`);
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.error('[WebSocket] Bybit error:', err.message);
    });

  } catch (err: any) {
    console.error('[WebSocket] Failed to connect to Bybit:', err.message);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (proactiveReconnectTimeout) clearTimeout(proactiveReconnectTimeout);
  setTimeout(() => {
    console.log(`[WebSocket] Reconnecting (delay: ${reconnectDelay}ms)...`);
    startLiveFeed();
    reconnectDelay = Math.min(reconnectDelay * 2, 60000);
  }, reconnectDelay);
}

export function stopLiveFeed() {
  isShuttingDown = true;
  if (proactiveReconnectTimeout) clearTimeout(proactiveReconnectTimeout);
  if (ws) {
    try {
      ws.close();
    } catch (err) {
      // Ignore
    }
  }
}
