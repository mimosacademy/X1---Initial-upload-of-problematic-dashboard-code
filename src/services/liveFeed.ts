import WebSocket from 'ws';
import { FIXED_TRADE_PAIRS } from '../config/pairs.js';

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

export function getLivePrice(symbol: string): LivePriceData | null {
  const cached = livePriceCache.get(symbol);
  if (!cached) return null;
  // If the cache is older than 10 seconds, treat it as stale/stuck
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

  console.log('[WebSocket] Initializing single-connection Binance combined streams feed...');

  // Build the combined stream query parameter
  const streams = FIXED_TRADE_PAIRS.map(
    symbol => `${symbol.toLowerCase()}@bookTicker/${symbol.toLowerCase()}@markPrice@1s`
  ).join('/');

  const wsUrl = `wss://fstream.binance.com/stream?streams=${streams}`;

  try {
    ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log('[WebSocket] Successfully connected to Binance Combined Streams.');
      reconnectDelay = 1000; // Reset exponential backoff on success

      // Schedule proactive reconnect in 23.5 hours
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

        if (msg.stream && msg.data) {
          const data = msg.data;
          const symbol = data.s; // e.g. "BTCUSDT"
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

          if (msg.stream.endsWith('@bookTicker')) {
            cached.bidPrice = parseFloat(data.b);
            cached.askPrice = parseFloat(data.a);
            if (cached.markPrice === 0) {
              cached.markPrice = (cached.bidPrice + cached.askPrice) / 2;
            }
          } else if (msg.stream.endsWith('@markPrice@1s')) {
            cached.markPrice = parseFloat(data.p);
            if (cached.bidPrice === 0) {
              cached.bidPrice = cached.markPrice;
              cached.askPrice = cached.markPrice;
            }
          }

          cached.lastUpdated = Date.now();
          livePriceCache.set(symbol, cached);
        }
      } catch (err) {
        // Suppress tick parsing noise to prevent console flooding
      }
    });

    ws.on('ping', () => {
      ws?.pong();
    });

    ws.on('close', (code, reason) => {
      if (isShuttingDown) return;
      console.log(`[WebSocket] Connection closed (Code: ${code}, Reason: ${reason}). Reconnecting...`);
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.error('[WebSocket] Error occurred on connection:', err.message);
      // Let 'close' handler handle the reconnection
    });

  } catch (err: any) {
    console.error('[WebSocket] Failed to establish connection:', err.message);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (proactiveReconnectTimeout) clearTimeout(proactiveReconnectTimeout);
  setTimeout(() => {
    console.log(`[WebSocket] Attempting connection retry (delay: ${reconnectDelay}ms)...`);
    startLiveFeed();
    reconnectDelay = Math.min(reconnectDelay * 2, 60000); // Caps at 1 minute
  }, reconnectDelay);
}

export function stopLiveFeed() {
  isShuttingDown = true;
  if (proactiveReconnectTimeout) clearTimeout(proactiveReconnectTimeout);
  if (ws) {
    try {
      ws.close();
    } catch (err) {
      // Ignore closing errors
    }
  }
}
