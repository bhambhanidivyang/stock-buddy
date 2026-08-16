import { TradeStatus } from '../database/enums';
import type { LiveConfig } from './types';
import type {
  BuySafetyInput,
  ExecutionQuote,
  SafetyCheck,
  SellSafetyInput,
} from './types';

export function isQuoteFresh(
  quote: ExecutionQuote,
  config: LiveConfig,
): SafetyCheck {
  if (!(quote.price > 0)) {
    return { ok: false, code: 'NO_LTP', reason: 'Live quote has no usable LTP' };
  }
  if (quote.fetchAgeMs > config.quoteMaxAgeMs) {
    return {
      ok: false,
      code: 'QUOTE_FETCH_STALE',
      reason: `Live quote fetch is stale (${quote.fetchAgeMs}ms > ${config.quoteMaxAgeMs}ms)`,
    };
  }
  if (quote.quotedAt == null || quote.exchangeDelayMs == null) {
    return {
      ok: false,
      code: 'QUOTE_NO_TIMESTAMP',
      reason: 'Live quote has no exchange/vendor timestamp',
    };
  }
  if (quote.exchangeDelayMs > config.quoteMaxExchangeDelayMs) {
    return {
      ok: false,
      code: 'QUOTE_EXCHANGE_STALE',
      reason: `Live quote exchange time is stale (${quote.exchangeDelayMs}ms > ${config.quoteMaxExchangeDelayMs}ms)`,
    };
  }
  return { ok: true, code: 'OK', reason: 'Quote is fresh' };
}

export function validateBuy(
  input: BuySafetyInput,
  config: LiveConfig,
): SafetyCheck {
  if (!input.marketOpen) {
    return {
      ok: false,
      code: 'MARKET_CLOSED',
      reason: 'Market is not open for trading',
    };
  }
  if (!input.quote) {
    return {
      ok: false,
      code: 'NO_QUOTE',
      reason: `No live quote for ${input.symbol}; cannot buy`,
    };
  }
  const fresh = isQuoteFresh(input.quote, config);
  if (!fresh.ok) {
    return fresh;
  }
  const price = input.quote.price;
  if (price < input.buyLow || price > input.buyHigh) {
    return {
      ok: false,
      code: 'OUTSIDE_ENTRY_BAND',
      reason: `LTP ${price} is outside entry band ${input.buyLow}–${input.buyHigh}`,
    };
  }
  if (!Number.isInteger(input.qty) || input.qty < 1) {
    return {
      ok: false,
      code: 'INVALID_QTY',
      reason: 'Order quantity is invalid',
    };
  }
  const cost = price * input.qty;
  if (input.availableCash < cost) {
    return {
      ok: false,
      code: 'INSUFFICIENT_CASH',
      reason: `Insufficient cash: need ${cost.toFixed(2)}, have ${input.availableCash.toFixed(2)}`,
    };
  }
  return { ok: true, code: 'OK', reason: 'Buy is safe' };
}

export function validateSell(
  input: SellSafetyInput,
  config: LiveConfig,
): SafetyCheck {
  if (!input.marketOpen) {
    return {
      ok: false,
      code: 'MARKET_CLOSED',
      reason: 'Market is not open for trading; sell blocked',
    };
  }
  if (
    input.status !== TradeStatus.OPEN &&
    input.status !== TradeStatus.NEEDS_REVIEW
  ) {
    return {
      ok: false,
      code: 'NO_POSITION',
      reason: `No sellable position (${input.status})`,
    };
  }
  if (!Number.isInteger(input.heldQty) || input.heldQty < 1) {
    return {
      ok: false,
      code: 'NO_POSITION',
      reason: 'Broker/internal held quantity is zero',
    };
  }
  if (
    !Number.isInteger(input.requestedQty) ||
    input.requestedQty < 1 ||
    input.requestedQty > input.heldQty
  ) {
    return {
      ok: false,
      code: 'QTY_EXCEEDS_HELD',
      reason: `Requested qty ${input.requestedQty} exceeds held ${input.heldQty}`,
    };
  }
  if (!input.quote) {
    return {
      ok: false,
      code: 'NO_QUOTE',
      reason: `No live quote for ${input.symbol}; sell blocked`,
    };
  }
  const fresh = isQuoteFresh(input.quote, config);
  if (!fresh.ok) {
    return fresh;
  }
  return { ok: true, code: 'OK', reason: 'Sell is safe' };
}
