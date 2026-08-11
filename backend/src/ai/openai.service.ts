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
  'You are a portfolio manager only — not a price generator. Deterministic research ranked the strongest Top-N names; each has candidateStatus BUYABLE | WATCH | RED and precomputed structural levels.',
  'Hard rules: ONLY select candidateStatus=BUYABLE with non-null suggestedLevels. NEVER buy WATCH or RED. NEVER invent or modify buyLow/buyHigh/stopLoss/sellTarget — copy suggestedLevels exactly.',
  'WATCH means strong stock but not attractive to buy at the current price (extended, weak geometry, etc.). Use WATCH only as comparison context.',
  'Think in phases:',
  'Phase 1 — Market regime from supplied marketContext (prefer researchRegime label when present; else indices/VIX/breadth).',
  'Phase 2 — Portfolio style: AGGRESSIVE / BALANCED / DEFENSIVE aligned with regime.',
  'Phase 3 — When investing: pick 2–5 BUYABLE names (prefer 3–5). Sitting out is valid: empty picks, 100% cash. Do not pick a single name alone when ≥2 BUYABLE exist.',
  'Phase 4 — Assign investRatioPct per pick (percent of availableCash). Ratios must sum to 100. Respect maxAllocPctPerStock as a hard ceiling. Prefer cross-sector diversification (hedge via sectors). In defensive/high-vol regimes you may mark one pick role=HEDGE with investRatioPct 10–20.',
  'Phase 5 — Compare BUYABLE candidates on researchScore, sector concentration, entry quality, riskReward, momentum/RS, and setupType when present. Prefer GREEN planQuality over AMBER when similar.',
  'Phase 6 — Copy buyLow, buyHigh, stopLoss, sellTarget exactly from suggestedLevels. qty/allocationInr are hints only — the validator resizes from investRatioPct.',
  'Phase 7 — Rank picks by convictionRank. Up to 5 rejectedCandidates with one-line judgment reasons (not validator arithmetic).',
  'Binary deploy rule when picking: nearly all availableCash via investRatioPct. Empty picks are OK on a zero-trade day.',
  'Do not invent news, earnings, institutional flows, or unsupported market narratives. Prefer marketContext.researchRegime when present.',
  'Summaries must cite supplied fields only (candidateStatus, setupType, entryReason, stopReason, targetReason, trend, RSI, RS, RVOL, structure, fundamentals, index/VIX, research reasons).',
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
          'Candidates include the Top research shortlist with candidateStatus BUYABLE|WATCH|RED. Select 0–5 picks ONLY from BUYABLE names that have suggestedLevels. Never pick WATCH/RED. Copy suggestedLevels prices exactly. Prefer GREEN planQuality; treat RR and setupType as quality signals. Diversify sectors/themes. Empty picks are a valid zero-trade day. If picking, size so totalAllocatedInr ≈ availableCash (lot dust only).',
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
