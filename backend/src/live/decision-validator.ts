import { ManagementPhase } from '../database/enums';
import { derivePhase } from './position-snapshot';
import type {
  AiPositionDecision,
  LiveConfig,
  PositionSnapshot,
  ValidationVerdict,
} from './types';

const ALLOWED = new Set([
  'HOLD',
  'EXIT_NOW',
  'PROTECT_PROFIT',
  'MOVE_STOP',
  'TAKE_PARTIAL_PROFIT',
]);

/**
 * Deterministic safety layer on AI actions.
 * AI may recommend; this decides whether the backend will execute.
 */
export function validateAiDecision(
  decision: AiPositionDecision,
  snapshot: PositionSnapshot,
  config: LiveConfig,
): ValidationVerdict {
  if (!ALLOWED.has(decision.action)) {
    return block(`Unknown AI action ${String(decision.action)}`);
  }
  if (decision.symbol !== snapshot.symbol) {
    return block(
      `AI symbol ${decision.symbol} does not match position ${snapshot.symbol}`,
    );
  }
  if (snapshot.qty < 1) {
    return block('Position quantity is invalid');
  }

  if (decision.action === 'HOLD') {
    return {
      allow: true,
      reason: 'HOLD — no order',
      effectiveStop: null,
      executeExit: false,
      applyStop: false,
    };
  }

  if (decision.action === 'TAKE_PARTIAL_PROFIT') {
    if (!config.partialProfitEnabled) {
      return block(
        'TAKE_PARTIAL_PROFIT is designed but disabled until a backtested quantity policy is configured',
      );
    }
    return block(
      'TAKE_PARTIAL_PROFIT has no configured quantity policy',
    );
  }

  if (decision.action === 'EXIT_NOW') {
    return {
      allow: true,
      reason: decision.reason || 'AI EXIT_NOW',
      effectiveStop: null,
      executeExit: true,
      applyStop: false,
    };
  }

  if (decision.action === 'MOVE_STOP') {
    const stop = resolveSuggestedStop(decision, snapshot, 'MOVE_STOP');
    if (!stop.ok) {
      return block(stop.reason);
    }
    return {
      allow: true,
      reason: decision.reason || 'AI MOVE_STOP',
      effectiveStop: stop.stop,
      executeExit: false,
      applyStop: true,
    };
  }

  if (decision.action === 'PROTECT_PROFIT') {
    if (snapshot.currentPnl <= 0) {
      return block('PROTECT_PROFIT requires an unrealized profit');
    }
    const suggested = decision.suggestedStop;
    if (suggested != null) {
      const stop = resolveSuggestedStop(decision, snapshot, 'PROTECT_PROFIT');
      if (!stop.ok) {
        return block(stop.reason);
      }
      return {
        allow: true,
        reason: decision.reason || 'AI PROTECT_PROFIT',
        effectiveStop: stop.stop,
        executeExit: false,
        applyStop: true,
      };
    }
    const breakeven = Math.max(snapshot.currentStop, snapshot.entryPrice);
    if (breakeven >= snapshot.currentLtp) {
      return block(
        'Breakeven stop would be at/above LTP; use EXIT_NOW instead of inventing a stop',
      );
    }
    if (breakeven <= snapshot.currentStop) {
      return {
        allow: true,
        reason: 'PROTECT_PROFIT — already at or above breakeven; phase only',
        effectiveStop: null,
        executeExit: false,
        applyStop: false,
      };
    }
    return {
      allow: true,
      reason: decision.reason || 'AI PROTECT_PROFIT to breakeven',
      effectiveStop: breakeven,
      executeExit: false,
      applyStop: true,
    };
  }

  return block('Unhandled AI action');
}

function resolveSuggestedStop(
  decision: AiPositionDecision,
  snapshot: PositionSnapshot,
  action: string,
): { ok: true; stop: number } | { ok: false; reason: string } {
  const suggested = decision.suggestedStop;
  if (suggested == null || !Number.isFinite(suggested) || suggested <= 0) {
    return {
      ok: false,
      reason: `${action} requires a finite suggestedStop for the deterministic validator`,
    };
  }
  if (suggested <= snapshot.currentStop) {
    return {
      ok: false,
      reason: `suggestedStop ${suggested} does not raise the current stop ${snapshot.currentStop}`,
    };
  }
  if (suggested >= snapshot.currentLtp) {
    return {
      ok: false,
      reason: `suggestedStop ${suggested} is at/above LTP ${snapshot.currentLtp}; use EXIT_NOW rather than an immediate stop-out`,
    };
  }
  if (suggested < snapshot.originalStop) {
    return {
      ok: false,
      reason: `suggestedStop ${suggested} is below the original hard stop ${snapshot.originalStop}`,
    };
  }
  return { ok: true, stop: suggested };
}

function block(reason: string): ValidationVerdict {
  return {
    allow: false,
    reason,
    effectiveStop: null,
    executeExit: false,
    applyStop: false,
  };
}

export function phaseAfterDecision(
  snapshot: PositionSnapshot,
  decision: AiPositionDecision,
  verdict: ValidationVerdict,
): ManagementPhase {
  if (verdict.executeExit) {
    return snapshot.managementPhase ?? ManagementPhase.ACTIVE;
  }
  const nextStop = verdict.applyStop
    ? (verdict.effectiveStop ?? snapshot.currentStop)
    : snapshot.currentStop;
  const action =
    decision.action === 'PROTECT_PROFIT' || decision.action === 'MOVE_STOP'
      ? decision.action
      : null;
  return derivePhase(
    snapshot.managementPhase,
    snapshot.currentPnl,
    nextStop,
    snapshot.entryPrice,
    action,
  );
}
