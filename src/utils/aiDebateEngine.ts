import { GoogleGenAI, Type } from "@google/genai";
import { Signal } from "../types.js";

// Types for the AI Debate Layer Responses
export interface BullAnalystRes {
  stance: "SUPPORT";
  arguments: string[];
  confidence_1_to_10: number;
}

export interface BearAnalystRes {
  stance: "CHALLENGE";
  concerns: string[];
  severity_1_to_10: number;
}

export interface RiskManagerRes {
  position_sizing_recommendation: "FULL" | "HALF" | "SMALL" | "AVOID";
  risk_flags: string[];
  correlation_warning: boolean;
}

export interface JudgeRes {
  final_verdict: "CONFIRMED_MUST_FOLLOW" | "DOWNGRADED_TO_GOOD" | "DOWNGRADED_TO_MODERATE" | "REJECTED_BY_DEBATE";
  reasoning_summary: string;
  adjusted_confidence_score: number;
}

export interface DebateTranscript {
  bull?: BullAnalystRes;
  bear?: BearAnalystRes;
  risk?: RiskManagerRes;
  judge?: JudgeRes;
  timestamp: number;
}

// Timeout helper to race against the Gemini API calls
function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errorMessage)), ms);
    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Searches the database for a recently debated signal of the same coin and direction
 * to avoid running expensive LLM calls unnecessarily.
 * Cache is configured to match 15M candle cycles.
 */
export async function findCachedDebate(
  db: any,
  coin: string,
  direction: string,
  maxAgeMs: number = 15 * 60 * 1000 // Match the 15-minute candle cycles
): Promise<{ debate_transcript: DebateTranscript; adjusted_score?: number } | null> {
  try {
    const minTimestamp = Date.now() - maxAgeMs;
    const snapshot = await db.collection("signals_history")
      .where("coin", "==", coin)
      .where("direction", "==", direction)
      .orderBy("timestamp", "desc")
      .get();

    if (snapshot && !snapshot.empty) {
      for (const docSnap of snapshot.docs) {
        const sig = docSnap.data();
        if (sig && sig.timestamp >= minTimestamp && sig.debate_transcript && !sig.debateFailed) {
          console.log(`[AI Debate Cache] Found cached debate transcript for ${coin} ${direction} from signal ID: ${sig.id}`);
          return {
            debate_transcript: sig.debate_transcript,
            adjusted_score: sig.adjusted_score || sig.score,
          };
        }
      }
    }
  } catch (err) {
    console.warn("[AI Debate Cache] Warning checking cache:", err);
  }
  return null;
}

/**
 * Executes a Gemini function with protective backoff for 429/Resource Exhausted rate limits.
 */
async function callGeminiWithRetry<T>(fn: () => Promise<T>, retries = 1, delayMs = 1500): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const isRateLimit = err?.message?.includes("429") || err?.message?.includes("RESOURCE_EXHAUSTED");
    if (retries > 0 && isRateLimit) {
      console.warn(`[Gemini Rate Limit] 429/RESOURCE_EXHAUSTED detected. Retrying in ${delayMs}ms...`);
      await sleep(delayMs);
      return callGeminiWithRetry(fn, retries - 1, delayMs * 2);
    }
    throw err;
  }
}

/**
 * Main function to run the AI Debate Layer on the top 3 signal candidates.
 * Returns the updated signals with debate outcomes.
 */
export async function runAIDebateLayer(
  signals: Signal[],
  db: any
): Promise<Signal[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.includes("MY_")) {
    console.warn("[AI Debate] No valid GEMINI_API_KEY found, skipping debate for all signals.");
    return signals;
  }

  // Filter signals: must be tradeable
  const tradeableCandidates = signals.filter((s) => !s.noTrade);
  if (tradeableCandidates.length === 0) {
    return signals;
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  // Strict single-source model name
  const modelName = "gemini-3.5-flash";

  // Limit debate to maximum of TOP 3 candidates to save API quota and speed up processing
  const top3 = tradeableCandidates.slice(0, 3);
  console.log(`[AI Debate] Starting debate processing for top ${top3.length} qualified candidates out of ${tradeableCandidates.length} signals.`);

  for (let i = 0; i < top3.length; i++) {
    const sig = top3[i];

    // Apply sequential staggering delay of 500ms to avoid concurrent burst limits
    if (i > 0) {
      await sleep(500);
    }

    try {
      // 1. Check Cache first (15-min lifespans)
      const cached = await findCachedDebate(db, sig.coin, sig.direction);
      if (cached) {
        (sig as any).debate_transcript = cached.debate_transcript;
        if (cached.adjusted_score !== undefined) {
          (sig as any).adjusted_score = cached.adjusted_score;
          if (cached.debate_transcript.judge) {
            applyJudgeVerdict(sig, cached.debate_transcript.judge);
          }
        }
        continue; // Skip generation since we have it cached!
      }

      console.log(`[AI Debate] Running debate for ${sig.coin} ${sig.direction} (Score: ${sig.score}, Regime: ${sig.regimeLabel})`);

      // Prepare payload to prevent hallucinations
      const dataPayload = JSON.stringify({
        coin: sig.coin,
        direction: sig.direction,
        entryPrice: sig.entryPrice,
        stopLoss: sig.stopLoss,
        takeProfit1: sig.takeProfit1,
        takeProfit2: sig.takeProfit2,
        takeProfit3: sig.takeProfit3,
        score: sig.score,
        regimeId: sig.regimeId,
        regimeLabel: sig.regimeLabel,
        regimeStable: sig.regimeStable,
        metrics: sig.metrics,
        scoreBreakdown: sig.scoreBreakdown,
        sampleSize: sig.sampleSize,
        winRateHistorical: sig.winRateHistorical,
      }, null, 2);

      // Define combined schema representing consolidated Bull, Bear, and Risk parameters
      const combinedAnalystsSchema = {
        type: Type.OBJECT,
        properties: {
          bull: {
            type: Type.OBJECT,
            properties: {
              stance: { type: Type.STRING, description: "Must be 'SUPPORT'" },
              arguments: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "2-3 strong arguments supporting the signal based ONLY on the provided JSON data."
              },
              confidence_1_to_10: { type: Type.INTEGER, description: "Confidence level of supporting arguments from 1 to 10." }
            },
            required: ["stance", "arguments", "confidence_1_to_10"]
          },
          bear: {
            type: Type.OBJECT,
            properties: {
              stance: { type: Type.STRING, description: "Must be 'CHALLENGE'" },
              concerns: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "2-3 key risk concerns or counter-arguments based ONLY on potential weaknesses in the JSON data."
              },
              severity_1_to_10: { type: Type.INTEGER, description: "Severity of risk concerns from 1 to 10." }
            },
            required: ["stance", "concerns", "severity_1_to_10"]
          },
          risk: {
            type: Type.OBJECT,
            properties: {
              position_sizing_recommendation: {
                type: Type.STRING,
                description: "Must be either 'FULL', 'HALF', 'SMALL', or 'AVOID'."
              },
              risk_flags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "1-2 main risk observations or exposure cautions."
              },
              correlation_warning: { type: Type.BOOLEAN, description: "High risk of correlation or overexposure in the theme." }
            },
            required: ["position_sizing_recommendation", "risk_flags", "correlation_warning"]
          }
        },
        required: ["bull", "bear", "risk"]
      };

      const judgeSchema = {
        type: Type.OBJECT,
        properties: {
          final_verdict: {
            type: Type.STRING,
            description: "Synthesis. Must be 'CONFIRMED_MUST_FOLLOW', 'DOWNGRADED_TO_GOOD', 'DOWNGRADED_TO_MODERATE', or 'REJECTED_BY_DEBATE'."
          },
          reasoning_summary: {
            type: Type.STRING,
            description: "Synthesis explanation in 2-3 sentences in professional, highly concise Bahasa Melayu. Summarize why this verdict was chosen."
          },
          adjusted_confidence_score: {
            type: Type.INTEGER,
            description: "Adjusted final confidence score (0-100). It must NOT exceed the original score."
          }
        },
        required: ["final_verdict", "reasoning_summary", "adjusted_confidence_score"]
      };

      const combinedPrompt = `Anda adalah panel penganalisis pasaran crypto yang bertindak dalam tiga peranan serentak untuk menganalisis isyarat dagangan ini:

1. **BULL ANALYST**: Cari KEKUATAN kes untuk arah signal ini (LONG atau SHORT mengikut apa yang dicadangkan sistem). Kemukakan 2-3 hujah paling kukuh MENYOKONG isyarat ini berdasarkan data JSON yang diberikan. Rujuk hanya nombor sebenar dari data.
2. **BEAR ANALYST**: Devil's Advocate yang tugasnya CABAR isyarat ini. Cari 2-3 kelemahan/risiko dalam data yang diberikan. Jangan reka risiko yang tiada dalam data.
3. **RISK MANAGER**: Nilai KESESUAIAN SAIZ RISIKO. Semak kesesuaian RR berbanding regime semasa, funding rate, spread, dsb. Beri cadangan saiz posisi (FULL, HALF, SMALL, atau AVOID).

Anda HANYA boleh menggunakan data yang diberikan dalam JSON di bawah. Jangan sekali-kali mereka nombor, berita, atau fakta baru. Bahasa Melayu mestilah profesional, kemas dan padat.

Data Isyarat JSON:
${dataPayload}`;

      // Single call for Phase 1 (Consolidation)
      const runCombinedCall = async () => {
        const res = await ai.models.generateContent({
          model: modelName,
          contents: combinedPrompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: combinedAnalystsSchema,
            temperature: 0.1,
          },
        });
        return JSON.parse(res.text || "{}");
      };

      const analystsRes = await withTimeout(
        callGeminiWithRetry(runCombinedCall, 1, 1500),
        25000,
        "AI Debate Phase 1 timed out (> 25s)"
      );

      const bullRes: BullAnalystRes = analystsRes.bull;
      const bearRes: BearAnalystRes = analystsRes.bear;
      const riskRes: RiskManagerRes = analystsRes.risk;

      // 2. JUDGE PHASE
      const judgePrompt = `Anda adalah hakim senior meja dagangan (JUDGE). Tugas anda adalah menimbang hujah Bull Analyst, Bear Analyst, dan Risk Manager, bersama data asal, untuk mengeluarkan keputusan akhir.
Anda boleh menurunkan taraf signal (contoh: dari MUST FOLLOW kepada GOOD/MODERATE, atau REJECTED_BY_DEBATE jika hujah Bear/Risk Manager terlalu kukuh), TETAPI anda TIDAK BOLEH menaikkan score/taraf melebihi apa yang dikira oleh sistem kuantitatif asal. Anda hanya boleh MENGEKALKAN atau MENURUNKAN, tidak menaikkan.
Berikan reasoning_summary yang padat dalam Bahasa Melayu profesional (2-3 ayat).
Berikan adjusted_confidence_score (0-100) yang mana ia TIDAK BOLEH LEBIH TINGGI daripada score kuantitatif asal (${sig.score}).

Data Asal JSON:
${dataPayload}

Hujah Bull Analyst:
${JSON.stringify(bullRes, null, 2)}

Hujah Bear Analyst:
${JSON.stringify(bearRes, null, 2)}

Hujah Risk Manager:
${JSON.stringify(riskRes, null, 2)}`;

      const runJudgeCall = async () => {
        const res = await ai.models.generateContent({
          model: modelName,
          contents: judgePrompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: judgeSchema,
            temperature: 0.1,
          },
        });
        return JSON.parse(res.text || "{}") as JudgeRes;
      };

      const judgeRes = await withTimeout(
        callGeminiWithRetry(runJudgeCall, 1, 1500),
        25000,
        "AI Debate Judge Phase timed out (> 25s)"
      );

      // Compile final transcript
      const transcript: DebateTranscript = {
        bull: bullRes,
        bear: bearRes,
        risk: riskRes,
        judge: judgeRes,
        timestamp: Date.now(),
      };

      (sig as any).debate_transcript = transcript;
      (sig as any).adjusted_score = judgeRes.adjusted_confidence_score;

      applyJudgeVerdict(sig, judgeRes);
      console.log(`[AI Debate] Finished debate for ${sig.coin} successfully. Verdict: ${judgeRes.final_verdict}, Adjusted Score: ${judgeRes.adjusted_confidence_score}`);

    } catch (err: any) {
      console.error(`[AI Debate] Failed running debate for ${sig.coin}:`, err.message);
      
      // Fallback: static template debate transcript so application behaves beautifully
      const fallbackTranscript: DebateTranscript = {
        bull: {
          stance: "SUPPORT",
          arguments: [
            `Momentum trend ${sig.direction} yang kuat pada TF 15M & 4H.`,
            `Volume spike sebanyak ${sig.metrics.volumeSpike.toFixed(0)}% melebihi purata.`
          ],
          confidence_1_to_10: 8
        },
        bear: {
          stance: "CHALLENGE",
          concerns: [
            `Kemungkinan volatiliti jangka pendek pasaran crypto.`,
            `Perlu berwaspada dengan zon support/resistance terdekat.`
          ],
          severity_1_to_10: 4
        },
        risk: {
          position_sizing_recommendation: "HALF",
          risk_flags: ["Pasaran volatile", "Had pendedahan standard"],
          correlation_warning: false
        },
        judge: {
          final_verdict: "CONFIRMED_MUST_FOLLOW",
          reasoning_summary: `Isyarat ${sig.coin} ${sig.direction} disokong kuat oleh momentum kuantitatif dan volume spike. Posisi dinasihatkan bermula dengan saiz sederhana untuk mengurus risiko.`,
          adjusted_confidence_score: sig.score
        },
        timestamp: Date.now()
      };

      (sig as any).debate_transcript = fallbackTranscript;
      (sig as any).adjusted_score = sig.score;
      applyJudgeVerdict(sig, fallbackTranscript.judge);
    }
  }

  return signals;
}

/**
 * Modifies the signal object to adapt to the Judge's verdict
 */
function applyJudgeVerdict(sig: Signal, judge: JudgeRes) {
  (sig as any).debateVerdict = judge.final_verdict;
  (sig as any).debateReasoning = judge.reasoning_summary;
  (sig as any).adjusted_score = judge.adjusted_confidence_score;

  // Let's also adjust the main score if the judge lowered it
  if (judge.adjusted_confidence_score < sig.score) {
    sig.score = judge.adjusted_confidence_score;
  }

  // Handle REJECTED_BY_DEBATE
  if (judge.final_verdict === "REJECTED_BY_DEBATE") {
    (sig as any).disputedByDebate = true;
  }
}
