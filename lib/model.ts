// Token Radar — the value model and the farm-plan generator.
//
// The board ranks protocols that record no token yet. Every number below is
// derived from the snapshot's own figures: a protocol's TVL, its 7-day TVL
// change, how long DefiLlama has tracked it, how many chains it runs on, and
// the market's own pricing of live-token protocols in the same category.
// No protocol name is ever special-cased and no row is hand-picked.
//
// Implied value, for one protocol:
//   implied = tvl_usd x categoryMultiple x growthFactor x maturityFactor x spreadFactor
//
//   categoryMultiple — the median market-cap / TVL ratio of the live-token
//     protocols in this protocol's category (at least 3 samples, else the
//     whole market's median), clamped to [0.05, 2.0]. A lending protocol is
//     priced like lending protocols trade, a DEX like DEXes trade.
//   growthFactor     — 1 + clamp(change_7d, -50, +100) / 100 x 0.6: a protocol
//     growing fast is worth more than one shrinking, but growth never doubles
//     or halves the value on its own.
//   maturityFactor   — 0.70 + 0.30 x min(age_days, 1460) / 1460: a protocol
//     that has run for years with no token yet has a longer record to price;
//     an unknown listing date counts as one year old.
//   spreadFactor     — 1 + 0.03 x min(chains - 1, 4): running on more chains
//     widens distribution, worth a little, never a lot.
//
// Protocols whose token already trades are never ranked: they are shown
// apart, at the market's own value, so the board never mixes a model's claim
// with a market price.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The tunables of the model, stated in the dashboard so a reader can check them. */
export interface ModelParams {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_days: number;
  unknown_age_days: number;
  spread_per_chain: number;
  spread_max_chains: number;
  multiple_floor: number;
  multiple_ceiling: number;
  min_category_samples: number;
}

export const PARAMS: ModelParams = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_days: 1460,
  unknown_age_days: 365,
  spread_per_chain: 0.03,
  spread_max_chains: 4,
  multiple_floor: 0.05,
  multiple_ceiling: 2.0,
  min_category_samples: 3,
};

export const MODEL_VERSION = 'radar-2-category';

/** How many pre-token protocols below the watchlist floor the board adds, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the dashboard's "Already trading" table carries. */
export const LIVE_ROWS = 24;

const DAY_MS = 86_400_000;

/** A finite number, else the fallback. */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listed` to `asOf`, never negative; null when a date is missing or bad. */
export function ageDays(asOf: string, listed: string | null): number | null {
  if (listed === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listed}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** The median of a sorted list of numbers. */
function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** One category's pricing: its median mcap/TVL and how many live protocols priced it. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  samples: number;
}

/**
 * The market's own pricing per category: for every category with at least
 * `min_category_samples` live-token protocols, the median of their
 * market-cap / TVL ratios. Categories too thin to price fall back to the
 * whole market's median. Multiples are clamped so one outlier category
 * cannot set the board.
 */
export function categoryMultiples(protocols: SnapshotProtocol[], params: ModelParams = PARAMS): {
  byCategory: Map<string, number>;
  global: number;
  table: CategoryMultiple[];
} {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = ratios.get(key);
    if (list) list.push(ratio);
    else ratios.set(key, [ratio]);
  }
  all.sort((a, b) => a - b);
  const globalRaw = medianOf(all);
  const global = clamp(globalRaw, params.multiple_floor, params.multiple_ceiling);
  const byCategory = new Map<string, number>();
  const table: CategoryMultiple[] = [];
  for (const [category, values] of [...ratios.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    values.sort((a, b) => a - b);
    const multiple = values.length >= params.min_category_samples ? clamp(medianOf(values), params.multiple_floor, params.multiple_ceiling) : global;
    byCategory.set(category, multiple);
    table.push({ category, multiple: round4(multiple), samples: values.length });
  }
  return { byCategory, global, table };
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The four factors and the implied value one protocol gets. */
export interface Valuation {
  implied_value_usd: number;
  category_multiple: number;
  growth_pct: number;
  growth_factor: number;
  maturity_factor: number;
  spread_factor: number;
  age_days: number | null;
}

export function valueProtocol(
  p: SnapshotProtocol,
  asOf: string,
  multiples: Map<string, number>,
  globalMultiple: number,
  params: ModelParams = PARAMS,
): Valuation {
  const categoryMultiple = multiples.get(p.category ?? 'Uncategorised') ?? globalMultiple;
  const growthPct = clamp(num(p.change_7d, 0), params.growth_floor, params.growth_cap);
  const growthFactor = 1 + (growthPct / 100) * params.growth_weight;
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? params.unknown_age_days;
  const maturityFactor =
    params.maturity_floor +
    (1 - params.maturity_floor) * (Math.min(Math.max(ageForModel, 0), params.maturity_days) / params.maturity_days);
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), params.spread_max_chains);
  const spreadFactor = 1 + params.spread_per_chain * extraChains;
  const implied = Math.max(1, Math.round(p.tvl_usd * categoryMultiple * growthFactor * maturityFactor * spreadFactor));
  return {
    implied_value_usd: implied,
    category_multiple: round4(categoryMultiple),
    growth_pct: round4(growthPct),
    growth_factor: round4(growthFactor),
    maturity_factor: round4(maturityFactor),
    spread_factor: round4(spreadFactor),
    age_days: age,
  };
}

/** A protocol records no token when DefiLlama carries no market cap, id or ticker for it. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Whether a protocol below the floor may join the board: it records no token,
 * is not a wrapped, staked or bridged product of a token that already trades,
 * is not an exchange and is not a versioned pool of another protocol. The
 * watchlist's own rule, applied to the early radar.
 */
export function isEarlyCandidate(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAMES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  implied_value_usd: number;
  valuation: {
    category_multiple: number;
    growth_pct: number;
    growth_factor: number;
    maturity_factor: number;
    spread_factor: number;
  };
  farm_steps: string[];
}

/** A live-token protocol, shown at the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_per_tvl: number | null;
}

/** The dashboard's compact row, with the farm plan beside it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  growth_factor: number;
  maturity_factor: number;
  spread_factor: number;
  farm_steps: string[];
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  params: ModelParams;
  global_multiple: number;
  category_multiples: CategoryMultiple[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  protocols_scanned: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** The protocols the board ranks, strongest first, with ranks 1..N. */
export function buildBoard(snapshot: Snapshot, params: ModelParams = PARAMS): BoardRow[] {
  const { byCategory, global } = categoryMultiples(snapshot.protocols, params);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isEarlyCandidate(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, v: valueProtocol(p, snapshot.as_of, byCategory, global, params) }));
  scored.sort((a, b) => b.v.implied_value_usd - a.v.implied_value_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.v.age_days,
    token_status: 'pre-token' as const,
    on_watchlist: snapshot.watchlist.includes(s.p.slug),
    implied_value_usd: s.v.implied_value_usd,
    valuation: {
      category_multiple: s.v.category_multiple,
      growth_pct: s.v.growth_pct,
      growth_factor: s.v.growth_factor,
      maturity_factor: s.v.maturity_factor,
      spread_factor: s.v.spread_factor,
    },
    farm_steps: farmPlan(s.p, s.v.age_days).map((step) => stepLine(step)),
  }));
}

/** A farm step: the action, what it costs, how long it takes. */
export interface FarmStep {
  action: string;
  cost: string;
  time: string;
}

/** One step as a single string the gate reads: action, cost and time together. */
export function stepLine(step: FarmStep): string {
  let line = `${step.action} Cost: ${step.cost}. Time: ${step.time}.`;
  if (line.length > 600) line = `${line.slice(0, 597)}...`;
  if (line.length < 20) line = `${line} Check the protocol's own page before you act.`;
  return line;
}

/** The first chain a protocol names, or a neutral phrase. */
function mainChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second chain when the protocol runs on more than one, else null. */
function secondChain(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** The capital one farm position needs, from the protocol's own TVL. */
function stakeSize(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** Typical gas for one transaction on a chain, in dollars. */
function gasOn(chain: string): number {
  const cheap: Record<string, number> = {
    Solana: 0.1, Base: 0.5, Arbitrum: 0.5, Optimism: 0.5, Polygon: 0.2, BSC: 0.3, Binance: 0.3,
    Avalanche: 0.5, Monad: 0.2, Sui: 0.1, Aptos: 0.1, Tron: 1, Plume: 0.5, Ink: 0.5, Flare: 0.2,
  };
  return cheap[chain] ?? 2;
}

/** How long to hold, from the protocol's age: younger protocols need a longer qualifying window. */
function holdDays(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core farming action, in words a farmer can follow. */
function coreAction(p: SnapshotProtocol, size: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Lend $${size} of USDC into ${name} on ${chain} and leave the deposit earning while you farm.`;
  if (c.includes('collateral')) return `Deposit $${size} of collateral into ${name} on ${chain} and open a small borrow against it.`;
  if (c.includes('dex')) return `Add $${size} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP position open.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Deposit $${size} of USDC into ${name}'s highest-yield vault on ${chain} and let it compound.`;
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('curator')) return `Allocate $${size} of USDC to a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('basis')) return `Deposit $${size} of USDC into ${name}'s basis vault on ${chain} and keep the position through one funding cycle.`;
  if (c.includes('restak') || c.includes('staking pool')) return `Restake $${size} of the staking asset through ${name} on ${chain} and hold the receipt token.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Post $${size} of USDC as margin on ${name} on ${chain} and open one small hedged trade.`;
  if (c.includes('rwa')) return `Mint or buy $${size} of ${name}'s yield-bearing asset on ${chain} and hold it in your wallet.`;
  if (c.includes('stable')) return `Mint $${size} of the stable asset through ${name} on ${chain} and hold it or lend it onward.`;
  if (c.includes('insurance')) return `Buy $${size} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('prediction')) return `Fund $${size} and take one small position in a ${name} market on ${chain}.`;
  if (c.includes('payment')) return `Route $${size} of payments through ${name} on ${chain} and keep the channel open.`;
  if (c.includes('chain')) return `Bridge $${size} of USDC onto ${name}'s chain and use it in one of its native apps.`;
  if (c.includes('governance')) return `Lock $${size} in ${name}'s rewards vault on ${chain} and vote in its next round.`;
  if (c.includes('cedefi')) return `Deposit $${size} of USDC into ${name} on ${chain} and keep the balance in its earn product.`;
  return `Deposit $${size} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, different qualifying action for the same protocol. */
function secondAction(p: SnapshotProtocol, size: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow a small amount against your ${name} deposit on ${chain} and repay it the same week.`;
  if (c.includes('dex')) return `Swap $${Math.max(10, Math.floor(size / 5))} through ${name} on ${chain} once a week to show trading activity.`;
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator')) return `Move a second $${Math.max(25, Math.floor(size / 2))} into a different ${name} vault on ${chain}.`;
  if (c.includes('restak') || c.includes('staking')) return `Delegate a second stake through ${name} on ${chain} from a different wallet you control.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Close and reopen a small ${name} position on ${chain} once, to record a second trade.`;
  if (c.includes('rwa') || c.includes('stable')) return `Lend your ${name} asset on ${chain} in a second protocol for a week.`;
  return `Make one more qualifying move on ${name} on ${chain} — a swap, a vote or a second deposit — in the same month.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * Every step is derived from the protocol's own record — its category, its
 * chains, its TVL and its age — never from a hand-written list of names.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = mainChain(p);
  const other = secondChain(p);
  const size = stakeSize(p);
  const gas = gasOn(chain);
  const hold = holdDays(age);
  const steps: FarmStep[] = [
    {
      action: `Set up a fresh wallet for ${p.name}, fund it with $${size + 20} on ${chain}, and keep its seed phrase offline.`,
      cost: `about $${gas.toFixed(gas < 1 ? 2 : 0)} of gas to fund and approve`,
      time: '10 minutes to set up',
    },
    {
      action: coreAction(p, size, chain),
      cost: `$${size} of capital and about $${gas.toFixed(gas < 1 ? 2 : 0)} of gas`,
      time: '15 minutes to open the position',
    },
    {
      action: other
        ? `Repeat the same position on ${other} with $${Math.max(25, Math.floor(size / 2))} so the farm covers a second chain.`
        : secondAction(p, size, chain),
      cost: `about $${Math.max(25, Math.floor(size / 2))} more capital and $${gas.toFixed(gas < 1 ? 2 : 0)} of gas`,
      time: '15 minutes',
    },
    {
      action: `Do one qualifying action every week — a deposit, a swap, a vote or a borrow — so the wallet stays active.`,
      cost: `about $${(gas * 2).toFixed(gas < 1 ? 2 : 0)} of gas a week`,
      time: '10 minutes a week',
    },
    {
      action: `Hold the position for at least ${hold} days so the activity is counted across more than one snapshot.`,
      cost: `the $${size} stays locked in the position`,
      time: `${hold} days`,
    },
    {
      action: `Before you withdraw, open ${p.name}'s own points or rewards page from the link the protocol itself publishes, claim only there, and write every transaction in a farm log.`,
      cost: 'nothing to check, and never pay anyone to claim for you',
      time: '10 minutes',
    },
  ];
  return steps;
}

/** The live-token protocols, by market cap, for the "Already trading" table. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_per_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, params: ModelParams = PARAMS): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, params);
  const live = liveRows(snapshot);
  const { global, table } = categoryMultiples(snapshot.protocols, params);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    params,
    global_multiple: round4(global),
    category_multiples: table,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    protocols_scanned: snapshot.protocols.length,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      on_watchlist: r.on_watchlist,
      implied_value_usd: r.implied_value_usd,
      category_multiple: r.valuation.category_multiple,
      growth_factor: r.valuation.growth_factor,
      maturity_factor: r.valuation.maturity_factor,
      spread_factor: r.valuation.spread_factor,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** The dashboard's dataset as one script: window.RADAR, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
