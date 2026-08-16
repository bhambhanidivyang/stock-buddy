import { Injectable } from '@nestjs/common';
import { OpenAiService } from '../ai/openai.service';
import { POSITION_MANAGEMENT_RESPONSE_JSON_SCHEMA } from './ai-position.schema';
import {
  AI_POSITION_PROMPT_VERSION,
  type AiPositionPortfolioResponse,
  type MarketEvent,
  type PositionSnapshot,
} from './types';

const SYSTEM_PROMPT = [
  'You are StockBuddy live position manager for NSE cash intraday/swing paper trades.',
  'You receive the original AI thesis AND the current live market snapshot for every open position in the portfolio.',
  'Decide whether each original thesis is still valid right now.',
  'Allowed actions per position: HOLD, EXIT_NOW, PROTECT_PROFIT, MOVE_STOP, TAKE_PARTIAL_PROFIT.',
  'HOLD: thesis intact — keep the position. Hard stop remains the safety net.',
  'EXIT_NOW: thesis broken or continuation probability collapsed. Do NOT wait for the original target or hard stop. Backend sells at the live executable mark after safety checks.',
  'PROTECT_PROFIT: position is profitable but continuation is weakening. Prefer raising stop toward breakeven (suggestedStop) rather than inventing an arbitrary price. If you cannot justify a stop, still choose PROTECT_PROFIT with suggestedStop=null and the backend may raise to breakeven if that is geometrically valid.',
  'MOVE_STOP: trade has moved favorably. suggestedStop MUST be a tighter (higher) stop below current LTP and at/above the original hard stop. Never invent a random tick. If unsure, HOLD.',
  'TAKE_PARTIAL_PROFIT: capability only; backend will block until a quantity policy is configured. Prefer EXIT_NOW or PROTECT_PROFIT instead.',
  'Never invent news. Cite only supplied snapshot fields (thesis, LTP, VWAP, RSI, EMA, Nifty, distances, time since entry, MFE).',
  'You may exit before target. The original target is an expectation, not an order.',
  'Return a decision for EVERY supplied position symbol.',
  `promptVersion=${AI_POSITION_PROMPT_VERSION}`,
].join(' ');

@Injectable()
export class AiPositionService {
  constructor(private readonly openai: OpenAiService) {}

  evaluatePortfolio(input: {
    marketTs: string;
    marketSession: string;
    triggeredBy: string;
    events: MarketEvent[];
    positions: PositionSnapshot[];
  }) {
    const userPrompt = JSON.stringify(
      {
        instruction:
          'Compare originalThesis vs current market reality for each open position. Return structured actions only. Do not invent stop/exit prices that are not geometrically justified by the snapshot.',
        promptVersion: AI_POSITION_PROMPT_VERSION,
        ...input,
      },
      null,
      2,
    );

    return this.openai.completeStructured<AiPositionPortfolioResponse>({
      schemaName: 'stock_buddy_position_management',
      schema: POSITION_MANAGEMENT_RESPONSE_JSON_SCHEMA as unknown as Record<
        string,
        unknown
      >,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      promptVersion: AI_POSITION_PROMPT_VERSION,
    });
  }
}
