import { AI_POSITION_ACTIONS } from './types';

export const POSITION_MANAGEMENT_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['portfolioSummary', 'positions'],
  properties: {
    portfolioSummary: { type: 'string' },
    positions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'symbol',
          'action',
          'confidence',
          'reason',
          'suggestedStop',
          'suggestedExitPrice',
        ],
        properties: {
          symbol: { type: 'string' },
          action: { type: 'string', enum: [...AI_POSITION_ACTIONS] },
          confidence: { type: 'number' },
          reason: { type: 'string' },
          suggestedStop: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          suggestedExitPrice: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        },
      },
    },
  },
} as const;
