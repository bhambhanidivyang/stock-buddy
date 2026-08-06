export const RECOMMENDATION_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'marketRegime',
    'confidence',
    'portfolioStrategy',
    'portfolioSummary',
    'totalAllocatedInr',
    'cashReservedInr',
    'picks',
    'rejectedCandidates',
  ],
  properties: {
    marketRegime: {
      type: 'string',
      enum: [
        'BULLISH',
        'MODERATELY_BULLISH',
        'NEUTRAL',
        'MODERATELY_BEARISH',
        'BEARISH',
        'UNCERTAIN',
      ],
    },
    confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
    portfolioStrategy: {
      type: 'object',
      additionalProperties: false,
      required: [
        'style',
        'targetPositions',
        'cashReservePercent',
        'hedge',
        'reason',
      ],
      properties: {
        style: {
          type: 'string',
          enum: ['AGGRESSIVE', 'BALANCED', 'DEFENSIVE'],
        },
        targetPositions: { type: 'number' },
        cashReservePercent: { type: 'number' },
        hedge: { type: 'boolean' },
        reason: { type: 'string' },
      },
    },
    portfolioSummary: { type: 'string' },
    totalAllocatedInr: { type: 'number' },
    cashReservedInr: { type: 'number' },
    picks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'symbol',
          'qty',
          'allocationInr',
          'buyLow',
          'buyHigh',
          'sellTarget',
          'stopLoss',
          'role',
          'summary',
          'convictionRank',
        ],
        properties: {
          symbol: { type: 'string' },
          qty: { type: 'number' },
          allocationInr: { type: 'number' },
          buyLow: { type: 'number' },
          buyHigh: { type: 'number' },
          sellTarget: { type: 'number' },
          stopLoss: { type: 'number' },
          role: { type: 'string', enum: ['PRIMARY', 'HEDGE'] },
          summary: { type: 'string' },
          /** 1 = highest conviction among picks */
          convictionRank: { type: 'number' },
        },
      },
    },
    rejectedCandidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['symbol', 'reason'],
        properties: {
          symbol: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;

export interface AiPortfolioStrategy {
  style: 'AGGRESSIVE' | 'BALANCED' | 'DEFENSIVE';
  targetPositions: number;
  cashReservePercent: number;
  hedge: boolean;
  reason: string;
}

export interface AiRecommendationPick {
  symbol: string;
  qty: number;
  allocationInr: number;
  buyLow: number;
  buyHigh: number;
  sellTarget: number;
  stopLoss: number;
  role: 'PRIMARY' | 'HEDGE';
  summary: string;
  convictionRank: number;
}

export interface AiRejectedCandidate {
  symbol: string;
  reason: string;
}

export interface AiRecommendationResponse {
  marketRegime:
    | 'BULLISH'
    | 'MODERATELY_BULLISH'
    | 'NEUTRAL'
    | 'MODERATELY_BEARISH'
    | 'BEARISH'
    | 'UNCERTAIN';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  portfolioStrategy: AiPortfolioStrategy;
  portfolioSummary: string;
  totalAllocatedInr: number;
  cashReservedInr: number;
  picks: AiRecommendationPick[];
  rejectedCandidates: AiRejectedCandidate[];
}
