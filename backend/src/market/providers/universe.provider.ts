export type UniverseStock = {
  symbol: string;
  yahooSymbol: string;
  companyName: string;
  sector: string;
  series?: string;
  isin?: string | null;
};

export interface UniverseProvider {
  readonly name: string;
  getUniverse(asOf?: Date): Promise<UniverseStock[]>;
}

export const UNIVERSE_PROVIDER = Symbol('UNIVERSE_PROVIDER');
