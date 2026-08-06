import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  loadRecommendationConfig,
  PROMPT_VERSION,
  type RecommendationConfig,
} from '../config/recommendation.config';
import {
  AiRecommendationResponse,
  RECOMMENDATION_RESPONSE_JSON_SCHEMA,
} from './recommendation.schema';

export type AiPlanMetadata = {
  model: string;
  promptVersion: string;
  temperature: number | null;
  tokensPrompt: number | null;
  tokensCompletion: number | null;
  costUsd: number | null;
  provider: string;
};

const SYSTEM_PROMPT = [
  'You are an institutional Indian equity desk advising a paper-trading account on NSE for 1–5 day swing holds.',
  'Account goal: COMPOUND the full paper fund. availableCash is deployable capital. When you take risk, deploy essentially ALL of it (above minDeployCash).',
  'You are a portfolio manager only — not a stock predictor. Candidates were pre-ranked by a deterministic research engine for 1–5 day outperformance odds; your job is portfolio construction.',
  'Setup type, entry band, stop, and target are precomputed by Structure+ATR engines — never recalculate or invent INR prices.',
  'Think in phases:',
  'Phase 1 — Market regime from supplied marketContext (prefer researchRegime label when present; else indices/VIX/breadth).',
  'Phase 2 — Portfolio style: AGGRESSIVE / BALANCED / DEFENSIVE aligned with regime.',
  'Phase 3 — targetPositions and cashReservePercent. With picks: cashReservePercent ~0 (lot dust only). No setups: empty picks, 100% cash.',
  'Phase 4 — Select a diversified combination from VALID suggestedLevels only. Prefer researchScore / priority order when present; avoid overlapping themes and sector crowding.',
  'Phase 5 — Copy buyLow, buyHigh, stopLoss, sellTarget exactly from suggestedLevels. Prefer higher riskReward and clear setupType when ranking.',
  'Phase 6 — Conviction-weighted sizing within sizingRules; enough names so allocations can sum to ~100% of availableCash under max % (typically 3–5 PRIMARY).',
  'Phase 7 — Up to 5 rejectedCandidates with one-line judgment reasons (not validator arithmetic).',
  'Binary deploy rule: empty picks OR nearly all availableCash. Do not leave large cash with tiny positions.',
  'Unequal sizing by conviction is fine. Max two names per sector (validator enforces).',
  'Summaries must cite supplied fields only (setupType, entryReason, stopReason, targetReason, trend, RSI, RS, RVOL, structure, fundamentals, index/VIX, research reasons).',
  `promptVersion=${PROMPT_VERSION}`,
].join(' ');

@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;
  private readonly provider: string;

  constructor(private readonly config: ConfigService) {
    this.provider = (
      this.config.get<string>('AI_PROVIDER', 'openai') ?? 'openai'
    )
      .trim()
      .toLowerCase();
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    this.model = this.config.get<string>('OPENAI_MODEL', 'gpt-5.6-luna');
    this.client =
      this.provider === 'openai' && apiKey ? new OpenAI({ apiKey }) : null;
  }

  async createRecommendationPlan(input: {
    marketTs: string;
    marketSession: string;
    availableCash: number;
    openHoldings: unknown;
    marketContext: unknown;
    candidates: unknown;
    versions: unknown;
    rules: RecommendationConfig;
  }): Promise<{
    model: string;
    response: AiRecommendationResponse;
    aiMetadata: AiPlanMetadata;
    promptHash: string;
    userPrompt: string;
  }> {
    if (this.provider !== 'openai') {
      throw new ServiceUnavailableException(
        `AI_PROVIDER=${this.provider} is not supported yet. Set AI_PROVIDER=openai.`,
      );
    }
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is missing. Set it in .env before calling /recommendations.',
      );
    }

    const cfg = input.rules ?? loadRecommendationConfig();
    const userPrompt = JSON.stringify(
      {
        instruction:
          'Return a structured portfolio plan from the research-ranked BUYABLE list. Copy suggestedLevels prices exactly. Prefer diversification across sectors/themes over picking the single "best" stock. Empty picks OK only when sitting out. If picking, size so totalAllocatedInr ≈ availableCash (lot dust only).',
        promptVersion: PROMPT_VERSION,
        sizingRules: {
          minAllocPctPerStock: cfg.minAllocPct * 100,
          maxAllocPctPerStock: cfg.maxAllocPct * 100,
          maxPerSector: cfg.maxPerSector,
          fullCashDeploy: cfg.fullCashDeploy,
          maxCashLeftoverPct: cfg.maxCashLeftoverPct * 100,
          maxCashLeftoverInr: cfg.maxCashLeftoverInr,
          unequalSizingByConviction: true,
        },
        ...input,
      },
      null,
      2,
    );

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'stock_buddy_recommendation',
            strict: true,
            schema: RECOMMENDATION_RESPONSE_JSON_SCHEMA,
          },
        },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('OpenAI returned empty content');
      }

      const parsed = JSON.parse(content) as AiRecommendationResponse;
      const usage = completion.usage;
      return {
        model: this.model,
        response: parsed,
        promptHash: simpleHash(userPrompt),
        userPrompt,
        aiMetadata: {
          model: this.model,
          promptVersion: PROMPT_VERSION,
          temperature: null,
          tokensPrompt: usage?.prompt_tokens ?? null,
          tokensCompletion: usage?.completion_tokens ?? null,
          costUsd: null,
          provider: this.provider,
        },
      };
    } catch (error) {
      this.logger.error(
        `OpenAI recommendation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException(
        `OpenAI recommendation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function simpleHash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
  }
  return `h${(h >>> 0).toString(16)}`;
}
