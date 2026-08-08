export const RANK_FEATURE_VERSION = 1;
export const RANK_CONFIG_VERSION = 1;

export type ShortlistMode = 'activity' | 'ranking';
export type SectorMode = 'strict' | 'soft' | 'hybrid';
export type MissingFactorPolicy = 'redistribute' | 'exclude';

export type RankingConfig = {
  featureVersion: number;
  configVersion: number;
  shortlistMode: ShortlistMode;
  topK: number;
  sectorTopN: number;
  perSectorPool: number;
  sectorMode: SectorMode;
  wildcardPct: number;
  maxSectorShare: number;
  minSectorMembers: number;
  missingPolicy: MissingFactorPolicy;
  regimeNoTradeEnabled: boolean;
  skipDayRs20: boolean;
  rsLbShort: number;
  rsLbSwing: number;
  rsLbIntermediate: number;
  adxPeriod: number;
  nearHighBars: number;
  extSoftAtr: number;
  /** Category weights (must sum ≈ 1). */
  wRs: number;
  wTrend: number;
  wNearHigh: number;
  wPersistence: number;
  wSector: number;
  wVolume: number;
  wEvent: number;
  /** How many Yahoo deep-history wildcard candidates to consider outside top sectors. */
  wildcardCandidatePool: number;
  /**
   * Bhav sessions to sync/fetch for cheap return20/return5 preview.
   * Must be >= rsLbSwing + 1 (periodReturn/simpleReturn need lookback+1 closes).
   */
  bhavLookbackSessions: number;
  /**
   * Minimum fraction of liquid quotes with non-null return20 before ranking proceeds.
   * Below this → fail closed (empty shortlist); never alphabetical fallback.
   */
  minReturn20Coverage: number;
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

function requireBool(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = env[key];
  if (raw == null || String(raw).trim() === '') {
    throw new Error(`Missing required env ${key}`);
  }
  const v = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  throw new Error(`Invalid boolean for env ${key}: ${raw}`);
}

function requireShortlistMode(env: NodeJS.ProcessEnv): ShortlistMode {
  const raw = (env.REC_SHORTLIST_MODE ?? '').trim().toLowerCase();
  if (raw === 'activity' || raw === 'ranking') return raw;
  throw new Error(
    `Missing or invalid required env REC_SHORTLIST_MODE (expected activity|ranking)`,
  );
}

function requireSectorMode(env: NodeJS.ProcessEnv): SectorMode {
  const raw = (env.RANK_SECTOR_MODE ?? '').trim().toLowerCase();
  if (raw === 'strict' || raw === 'soft' || raw === 'hybrid') return raw;
  throw new Error(
    `Missing or invalid required env RANK_SECTOR_MODE (expected strict|soft|hybrid)`,
  );
}

function requireMissingPolicy(env: NodeJS.ProcessEnv): MissingFactorPolicy {
  const raw = (env.RANK_MISSING_POLICY ?? '').trim().toLowerCase();
  if (raw === 'redistribute' || raw === 'exclude') return raw;
  throw new Error(
    `Missing or invalid required env RANK_MISSING_POLICY (expected redistribute|exclude)`,
  );
}

/** Load research-ranking knobs. All RANK_* / REC_SHORTLIST_MODE required. */
export function loadRankingConfig(
  env: NodeJS.ProcessEnv = process.env,
): RankingConfig {
  const wRs = requireNum(env, 'RANK_W_RS');
  const wTrend = requireNum(env, 'RANK_W_TREND');
  const wNearHigh = requireNum(env, 'RANK_W_NEAR_HIGH');
  const wPersistence = requireNum(env, 'RANK_W_PERSISTENCE');
  const wSector = requireNum(env, 'RANK_W_SECTOR');
  const wVolume = requireNum(env, 'RANK_W_VOLUME');
  const wEvent = requireNum(env, 'RANK_W_EVENT');
  const sum = wRs + wTrend + wNearHigh + wPersistence + wSector + wVolume + wEvent;
  if (Math.abs(sum - 1) > 0.001) {
    throw new Error(
      `RANK_W_* weights must sum to 1.0 (got ${sum.toFixed(4)})`,
    );
  }

  const rsLbSwing = Math.max(1, Math.floor(requireNum(env, 'RANK_RS_LB_SWING')));
  const bhavLookbackSessions = Math.max(
    rsLbSwing + 1,
    Math.floor(requireNum(env, 'RANK_BHAV_LOOKBACK')),
  );
  const minReturn20Coverage = requireNum(env, 'RANK_MIN_RETURN20_COVERAGE');
  if (minReturn20Coverage < 0 || minReturn20Coverage > 1) {
    throw new Error(
      `RANK_MIN_RETURN20_COVERAGE must be in [0,1] (got ${minReturn20Coverage})`,
    );
  }

  return {
    featureVersion: RANK_FEATURE_VERSION,
    configVersion: RANK_CONFIG_VERSION,
    shortlistMode: requireShortlistMode(env),
    topK: Math.max(1, Math.floor(requireNum(env, 'RANK_TOP_K'))),
    sectorTopN: Math.max(1, Math.floor(requireNum(env, 'RANK_SECTOR_TOP_N'))),
    perSectorPool: Math.max(
      1,
      Math.floor(requireNum(env, 'RANK_PER_SECTOR_POOL')),
    ),
    sectorMode: requireSectorMode(env),
    wildcardPct: requireNum(env, 'RANK_WILDCARD_PCT'),
    maxSectorShare: requireNum(env, 'RANK_MAX_SECTOR_SHARE'),
    minSectorMembers: Math.max(
      1,
      Math.floor(requireNum(env, 'RANK_MIN_SECTOR_MEMBERS')),
    ),
    missingPolicy: requireMissingPolicy(env),
    regimeNoTradeEnabled: requireBool(env, 'RANK_REGIME_NOTRADE_ENABLED'),
    skipDayRs20: requireBool(env, 'RANK_SKIP_DAY_RS20'),
    rsLbShort: Math.max(1, Math.floor(requireNum(env, 'RANK_RS_LB_SHORT'))),
    rsLbSwing,
    rsLbIntermediate: Math.max(
      1,
      Math.floor(requireNum(env, 'RANK_RS_LB_INTERMEDIATE')),
    ),
    adxPeriod: Math.max(2, Math.floor(requireNum(env, 'RANK_ADX_PERIOD'))),
    nearHighBars: Math.max(
      20,
      Math.floor(requireNum(env, 'RANK_52W_BARS')),
    ),
    extSoftAtr: requireNum(env, 'RANK_EXT_SOFT_ATR'),
    wRs,
    wTrend,
    wNearHigh,
    wPersistence,
    wSector,
    wVolume,
    wEvent,
    wildcardCandidatePool: Math.max(
      0,
      Math.floor(requireNum(env, 'RANK_WILDCARD_CANDIDATE_POOL')),
    ),
    bhavLookbackSessions,
    minReturn20Coverage,
  };
}
