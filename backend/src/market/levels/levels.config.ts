/** Structure+ATR level engine parameters — all values from env (LVL_*). */

export type LevelsConfig = {
  swingWindow: number;
  clusterAtr: number;
  breakBufferAtr: number;
  minTouches: number;
  /** Donchian lookback for close-breakout level (prior bars, excluding signal bar). */
  breakoutLookbackDays: number;
  adxMin: number;
  emaPullbackAtr: number;
  emaMaxExtensionAtr: number;
  emaBandBelowAtr: number;
  emaTouchBars: number;
  pdhBreakLookback: number;
  pdhRetestBelowAtr: number;
  pdhRetestAboveAtr: number;
  pdhBandBelowAtr: number;
  pdhBandAboveAtr: number;
  breakoutMaxExtensionAtr: number;
  breakoutEntryAboveAtr: number;
  rvolBreakoutMin: number;
  retestLookback: number;
  retestBelowAtr: number;
  retestAboveAtr: number;
  retestTouchBars: number;
  /** Max distance above R (in ATR) for a low to count as "touched" R. */
  retestTouchAboveAtr: number;
  retestEntryBelowAtr: number;
  retestEntryAboveAtr: number;
  entryChaseAtr: number;
  entryMissedAtr: number;
  stopAtrBuffer: number;
  maxStopPctReject: number;
  maxStopAtrReject: number;
  minTargetRr: number;
  maxResistanceTargets: number;
  maxTargetAtr: number;
  /** Sessions after buyAt before time-stop. */
  maxHoldSessions: number;
};

function requireNum(env: NodeJS.ProcessEnv, key: string): number {
  const raw = env[key];
  if (raw == null || String(raw).trim() === '') {
    throw new Error(`Missing required env ${key}`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid number for env ${key}: ${raw}`);
  }
  return n;
}

export function loadLevelsConfig(
  env: NodeJS.ProcessEnv = process.env,
): LevelsConfig {
  return {
    swingWindow: Math.max(1, Math.floor(requireNum(env, 'LVL_SWING_WINDOW'))),
    clusterAtr: requireNum(env, 'LVL_CLUSTER_ATR'),
    breakBufferAtr: requireNum(env, 'LVL_BREAK_BUFFER_ATR'),
    minTouches: Math.max(1, Math.floor(requireNum(env, 'LVL_MIN_TOUCHES'))),
    breakoutLookbackDays: Math.max(
      2,
      Math.floor(requireNum(env, 'LVL_BREAKOUT_LOOKBACK_DAYS')),
    ),
    adxMin: requireNum(env, 'LVL_ADX_MIN'),
    emaPullbackAtr: requireNum(env, 'LVL_EMA_PULLBACK_ATR'),
    emaMaxExtensionAtr: requireNum(env, 'LVL_EMA_MAX_EXT_ATR'),
    emaBandBelowAtr: requireNum(env, 'LVL_EMA_BAND_BELOW_ATR'),
    emaTouchBars: Math.max(1, Math.floor(requireNum(env, 'LVL_EMA_TOUCH_BARS'))),
    pdhBreakLookback: Math.max(
      1,
      Math.floor(requireNum(env, 'LVL_PDH_BREAK_LOOKBACK')),
    ),
    pdhRetestBelowAtr: requireNum(env, 'LVL_PDH_RETEST_BELOW_ATR'),
    pdhRetestAboveAtr: requireNum(env, 'LVL_PDH_RETEST_ABOVE_ATR'),
    pdhBandBelowAtr: requireNum(env, 'LVL_PDH_BAND_BELOW_ATR'),
    pdhBandAboveAtr: requireNum(env, 'LVL_PDH_BAND_ABOVE_ATR'),
    breakoutMaxExtensionAtr: requireNum(env, 'LVL_BREAKOUT_MAX_EXT_ATR'),
    breakoutEntryAboveAtr: requireNum(env, 'LVL_BREAKOUT_ENTRY_ABOVE_ATR'),
    rvolBreakoutMin: requireNum(env, 'LVL_RVOL_BREAKOUT_MIN'),
    retestLookback: Math.max(
      1,
      Math.floor(requireNum(env, 'LVL_RETEST_LOOKBACK')),
    ),
    retestBelowAtr: requireNum(env, 'LVL_RETEST_BELOW_ATR'),
    retestAboveAtr: requireNum(env, 'LVL_RETEST_ABOVE_ATR'),
    retestTouchBars: Math.max(
      1,
      Math.floor(requireNum(env, 'LVL_RETEST_TOUCH_BARS')),
    ),
    retestTouchAboveAtr: requireNum(env, 'LVL_RETEST_TOUCH_ABOVE_ATR'),
    retestEntryBelowAtr: requireNum(env, 'LVL_RETEST_ENTRY_BELOW_ATR'),
    retestEntryAboveAtr: requireNum(env, 'LVL_RETEST_ENTRY_ABOVE_ATR'),
    entryChaseAtr: requireNum(env, 'LVL_ENTRY_CHASE_ATR'),
    entryMissedAtr: requireNum(env, 'LVL_ENTRY_MISSED_ATR'),
    stopAtrBuffer: requireNum(env, 'LVL_STOP_ATR_BUFFER'),
    maxStopPctReject: requireNum(env, 'LVL_MAX_STOP_PCT_REJECT'),
    maxStopAtrReject: requireNum(env, 'LVL_MAX_STOP_ATR_REJECT'),
    minTargetRr: requireNum(env, 'LVL_MIN_TARGET_RR'),
    maxResistanceTargets: Math.max(
      1,
      Math.floor(requireNum(env, 'LVL_MAX_RESISTANCE_TARGETS')),
    ),
    maxTargetAtr: requireNum(env, 'LVL_MAX_TARGET_ATR'),
    maxHoldSessions: Math.max(
      1,
      Math.floor(requireNum(env, 'LVL_MAX_HOLD_SESSIONS')),
    ),
  };
}
