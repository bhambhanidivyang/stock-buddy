import {
  loadLevelsConfig,
  type LevelsConfig,
} from '../market/levels/levels.config';
import {
  loadRankingConfig,
  type RankingConfig,
} from './ranking.config';

export const SCHEMA_VERSION = 1;
export const FEATURE_VERSION = 3;
export const CONFIG_VERSION = 6;
export const PROMPT_VERSION = 'portfolio-manager-v8-buyable-watch-red';

export type StrategyProfile = 'day' | 'swing';

export type RecommendationConfig = {
  strategyProfile: StrategyProfile;
  schemaVersion: number;
  featureVersion: number;
  configVersion: number;
  promptVersion: string;
  candidateLimit: number;
  priorityPool: number;
  minPrice: number;
  minHistoryBars: number;
  minAdtvInr: number;
  adtvLookbackDays: number;
  /** @deprecated legacy — use levels.minTargetRr */
  minTargetRr: number;
  minAllocPct: number;
  maxAllocPct: number;
  maxPerSector: number;
  fullCashDeploy: boolean;
  maxCashLeftoverPct: number;
  maxCashLeftoverInr: number;
  minDeployCashInr: number;
  /** Max recommendation runs per account per IST calendar day. */
  maxRecommendationsPerDay: number;
  aiIncludeExtendedTechnical: boolean;
  storeFullAiPrompt: boolean;
  levelsPriceTolerance: number;
  priorityWeightRvol: number;
  priorityWeightGap: number;
  priorityWeightAbsReturn: number;
  /** Tag reason when |change%| >= this. */
  priorityChangeTagMin: number;
  /** Tag reason when |gap%| >= this. */
  priorityGapTagMin: number;
  /** Tag reason when RVOL >= this. */
  priorityRvolTagMin: number;
  /** Cap RVOL contribution in priority score. */
  priorityRvolScoreCap: number;
  /** Fallback volume score when ADTV missing. */
  priorityVolumeFallbackMin: number;
  /** Structure + ATR level engine knobs */
  levels: LevelsConfig;
  /** Research ranking / shortlist mode */
  ranking: RankingConfig;
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

function requireStrategyProfile(env: NodeJS.ProcessEnv): StrategyProfile {
  const raw = env.REC_STRATEGY_PROFILE;
  if (raw === 'swing' || raw === 'day') return raw;
  throw new Error(
    `Missing or invalid required env REC_STRATEGY_PROFILE (expected day|swing)`,
  );
}

/** Load recommendation engine config from env. All knobs are required. */
export function loadRecommendationConfig(
  env: NodeJS.ProcessEnv = process.env,
): RecommendationConfig {
  const levels = loadLevelsConfig(env);
  const minTargetRr = env.REC_MIN_TARGET_RR
    ? requireNum(env, 'REC_MIN_TARGET_RR')
    : levels.minTargetRr;
  levels.minTargetRr = minTargetRr;

  return {
    strategyProfile: requireStrategyProfile(env),
    schemaVersion: SCHEMA_VERSION,
    featureVersion: FEATURE_VERSION,
    configVersion: CONFIG_VERSION,
    promptVersion: PROMPT_VERSION,
    levels,
    ranking: loadRankingConfig(env),
    minTargetRr,
    candidateLimit: Math.max(
      1,
      Math.floor(requireNum(env, 'REC_CANDIDATE_LIMIT')),
    ),
    priorityPool: Math.max(
      1,
      Math.floor(requireNum(env, 'REC_PRIORITY_POOL')),
    ),
    minPrice: requireNum(env, 'REC_MIN_PRICE'),
    minHistoryBars: requireNum(env, 'REC_MIN_HISTORY'),
    minAdtvInr: requireNum(env, 'REC_MIN_ADTV'),
    adtvLookbackDays: requireNum(env, 'REC_ADTV_LOOKBACK'),
    minAllocPct: requireNum(env, 'REC_MIN_ALLOC_PCT'),
    maxAllocPct: requireNum(env, 'REC_MAX_ALLOC_PCT'),
    maxPerSector: Math.floor(requireNum(env, 'REC_MAX_PER_SECTOR')),
    fullCashDeploy: requireBool(env, 'REC_FULL_CASH_DEPLOY'),
    maxCashLeftoverPct: requireNum(env, 'REC_MAX_CASH_LEFTOVER_PCT'),
    maxCashLeftoverInr: requireNum(env, 'REC_MAX_CASH_LEFTOVER_INR'),
    minDeployCashInr: requireNum(env, 'REC_MIN_DEPLOY_CASH_INR'),
    maxRecommendationsPerDay: Math.max(
      1,
      Math.floor(requireNum(env, 'REC_MAX_PER_DAY')),
    ),
    aiIncludeExtendedTechnical: requireBool(env, 'REC_AI_INCLUDE_EXTENDED'),
    storeFullAiPrompt: requireBool(env, 'REC_STORE_FULL_PROMPT'),
    levelsPriceTolerance: requireNum(env, 'REC_LEVELS_TOLERANCE'),
    priorityWeightRvol: requireNum(env, 'REC_PRIORITY_WEIGHT_RVOL'),
    priorityWeightGap: requireNum(env, 'REC_PRIORITY_WEIGHT_GAP'),
    priorityWeightAbsReturn: requireNum(
      env,
      'REC_PRIORITY_WEIGHT_ABS_RETURN',
    ),
    priorityChangeTagMin: requireNum(env, 'REC_PRIORITY_CHANGE_TAG_MIN'),
    priorityGapTagMin: requireNum(env, 'REC_PRIORITY_GAP_TAG_MIN'),
    priorityRvolTagMin: requireNum(env, 'REC_PRIORITY_RVOL_TAG_MIN'),
    priorityRvolScoreCap: requireNum(env, 'REC_PRIORITY_RVOL_SCORE_CAP'),
    priorityVolumeFallbackMin: requireNum(
      env,
      'REC_PRIORITY_VOLUME_FALLBACK_MIN',
    ),
  };
}
