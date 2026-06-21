/**
 * Economy & Residents system (docs/areas/03-economy-and-residents.md). Pure, atomic transitions over
 * `EconomyState`: debt-first income banking, buy-service / beg-favor flows, the favor-consequence
 * catalog, the reputation model, incident price/availability hooks, and the HUD availability query.
 * Renders nothing; applies meter relief only through the injected `applyRelief` sink (never imports
 * Meters directly — the relief-bridge composes the two areas). All numbers come from `ctx.content`.
 */
import { clamp, approach } from '../core/math';
import type { SystemContext } from '../core/system-context';
import type { Content } from '../content/loader';
import type { EconomyState } from '../state/game-state';
import type { IncidentFlags } from '../state/game-state';
import type { ResidentDef, ServiceDef, FavorDef, ReliefRequest } from '../content/residents';

export type EconomyError =
  | 'INSUFFICIENT_FUNDS'
  | 'NOT_BROKE'
  | 'SERVICE_DISABLED'
  | 'FAVOR_REFUSED'
  | 'UNKNOWN';

export type Result<T> = { ok: true; value: T } | { ok: false; error: EconomyError };

/** The meters-relief sink injected for buy/beg transactions (composed by the relief-bridge). */
export type ReliefSink = (req: ReliefRequest, qualityFactor?: number) => void;
export interface EconomyContext extends SystemContext {
  applyRelief: ReliefSink;
}

export interface InteractionOption {
  residentId: string;
  kind: 'service' | 'favor';
  id: string;
  label: string;
  effectivePrice: number | null; // null for favors
  affordable: boolean; // services only
  offerable: boolean; // passes gating + not disabled
  reason?: EconomyError;
}

export function createEconomyState(content: Content): EconomyState {
  const t = content.economy.tunables;
  const relationships: Record<string, number> = {};
  for (const r of content.economy.roster) relationships[r.id] = t.startingRelationship;
  return {
    rubles: 0,
    debt: 0,
    reputation: t.reputationBaseline,
    relationships,
    priceMultiplier: 1,
    disabledServiceTags: [],
    activeChore: null,
  };
}

export function netWorth(state: EconomyState): number {
  return state.rubles - state.debt;
}

export function effectivePrice(state: EconomyState, svc: ServiceDef): number {
  return Math.ceil(svc.basePrice * state.priceMultiplier);
}

function findResident(content: Content, id: string): ResidentDef | undefined {
  return content.economy.roster.find((r) => r.id === id);
}

function relationshipOf(state: EconomyState, content: Content, id: string): number {
  return state.relationships[id] ?? content.economy.tunables.startingRelationship;
}

/** Debt-first income banking (§3.2). Always emits rublesChanged (delta = net spendable change). */
export function bankIncome(state: EconomyState, amount: number, ctx: SystemContext): EconomyState {
  const t = ctx.content.economy.tunables;
  let debt = state.debt;
  let remaining = amount;
  if (debt > 0) {
    const paid = Math.min(remaining, debt);
    debt -= paid;
    remaining -= paid;
  }
  const rubles = state.rubles + remaining;
  const clearedDebt = state.debt > 0 && debt === 0;
  const reputation = clearedDebt
    ? clamp(state.reputation + t.debtClearReputationBonus, 0, 100)
    : state.reputation;
  ctx.events.emit('rublesChanged', { delta: rubles - state.rubles, total: rubles });
  return { ...state, debt, rubles, reputation };
}

/** Income subscription helper (§3.1): +1 ruble per player kill, nothing otherwise. */
export function handleDroneDestroyed(
  state: EconomyState,
  payload: { byPlayer: boolean },
  ctx: SystemContext,
): EconomyState {
  return payload.byPlayer ? bankIncome(state, 1, ctx) : state;
}

/** Buy a service (§3.5). Validates fully before any side effect — atomic. */
export function buyService(
  state: EconomyState,
  residentId: string,
  serviceId: string,
  ctx: EconomyContext,
): Result<EconomyState> {
  const resident = findResident(ctx.content, residentId);
  const service = resident?.services.find((s) => s.id === serviceId);
  if (!service) return { ok: false, error: 'UNKNOWN' };
  if (service.tags.some((tag) => state.disabledServiceTags.includes(tag))) {
    return { ok: false, error: 'SERVICE_DISABLED' };
  }
  const price = effectivePrice(state, service);
  if (state.rubles < price) return { ok: false, error: 'INSUFFICIENT_FUNDS' };

  const t = ctx.content.economy.tunables;
  const rel = clamp(relationshipOf(state, ctx.content, residentId) + t.buyRelationshipGain, 0, 100);
  const next: EconomyState = {
    ...state,
    rubles: state.rubles - price,
    relationships: { ...state.relationships, [residentId]: rel },
    reputation: clamp(state.reputation + t.buyReputationGain, 0, 100),
  };
  if (service.relief) ctx.applyRelief(service.relief, 1);
  ctx.events.emit('serviceBought', { residentId, service: serviceId, cost: price });
  return { ok: true, value: next };
}

/** Beg a favor (§3.6) — only while broke; grants the (possibly degraded) relief + one consequence. */
export function begFavor(
  state: EconomyState,
  residentId: string,
  favorId: string,
  ctx: EconomyContext,
): Result<EconomyState> {
  if (state.rubles !== 0) return { ok: false, error: 'NOT_BROKE' };
  const resident = findResident(ctx.content, residentId);
  const favor = resident?.favors.find((f) => f.id === favorId);
  if (!favor) return { ok: false, error: 'UNKNOWN' };

  const t = ctx.content.economy.tunables;
  const rel = relationshipOf(state, ctx.content, residentId);
  if (rel < t.refusalFloor || rel < favor.minRelationship) {
    return { ok: false, error: 'FAVOR_REFUSED' };
  }

  const quality = clamp(rel / t.qualityDivisor, t.qualityMin, t.qualityMax);
  const c = favor.consequence;
  const pen = t.begPenalty[c.kind];

  let debt = state.debt;
  let relAfter = clamp(rel - pen.relationship, 0, 100);
  let reputation = clamp(state.reputation - pen.reputation, 0, 100);
  let activeChore = state.activeChore;
  switch (c.kind) {
    case 'debt':
      debt += c.amount;
      break;
    case 'chore':
      activeChore = { residentId, secondsLeft: c.durationSeconds };
      break;
    case 'reputation':
      relAfter = clamp(rel - c.amount, 0, 100);
      reputation = clamp(state.reputation - c.amount, 0, 100);
      break;
    case 'degraded':
      break; // base penalty applied; relief is scaled below
  }

  const next: EconomyState = {
    ...state,
    debt,
    reputation,
    relationships: { ...state.relationships, [residentId]: relAfter },
    activeChore,
  };

  const reliefReq = degradeRelief(favor, c);
  if (reliefReq) ctx.applyRelief(reliefReq, quality);
  ctx.events.emit('favorBegged', { residentId, favor: favorId, consequence: c.kind });
  return { ok: true, value: next };
}

/** For a degraded consequence, scale the favor's relief and attach the side effect as `secondary`. */
function degradeRelief(favor: FavorDef, c: FavorDef['consequence']): ReliefRequest | undefined {
  const base = favor.relief;
  if (!base || c.kind !== 'degraded') return base;
  const out: ReliefRequest = { meter: base.meter, amount: base.amount * c.reliefScale };
  const sec = c.sideEffect ?? base.secondary;
  if (sec) out.secondary = sec;
  if (base.effect) out.effect = base.effect;
  return out;
}

/** Per-frame upkeep (§3.6/§3.8): chore countdown + reputation/relationship drift toward baseline. */
export function updateEconomy(state: EconomyState, dt: number, ctx: SystemContext): EconomyState {
  const t = ctx.content.economy.tunables;
  let activeChore = state.activeChore;
  if (activeChore) {
    const secondsLeft = activeChore.secondsLeft - dt;
    activeChore = secondsLeft <= 0 ? null : { residentId: activeChore.residentId, secondsLeft };
  }
  const relationships: Record<string, number> = {};
  for (const [id, val] of Object.entries(state.relationships)) {
    relationships[id] = approach(val, t.relationshipBaseline, t.relationshipDriftPerSec * dt);
  }
  const reputation = approach(state.reputation, t.reputationBaseline, t.reputationDriftPerSec * dt);
  return { ...state, activeChore, relationships, reputation };
}

/** Mirror incident flags into the economy slice (§3.9). Reads flag VALUES; never imports incidents. */
export function applyIncidentFlags(state: EconomyState, flags: IncidentFlags): EconomyState {
  const disabledServiceTags: string[] = [];
  if (flags.servicesDisabled) disabledServiceTags.push('delivery'); // broken elevator → no deliveries
  if (flags.toiletBlocked) disabledServiceTags.push('toilet'); // pipe failure → no toilet service
  return { ...state, priceMultiplier: flags.servicePriceMultiplier, disabledServiceTags };
}

/** Pure read model for the HUD interaction menu (§3.11). Side-effect free; safe to call per frame. */
export function getAvailableInteractions(state: EconomyState, content: Content): InteractionOption[] {
  const t = content.economy.tunables;
  const broke = state.rubles === 0;
  const out: InteractionOption[] = [];
  for (const res of content.economy.roster) {
    for (const svc of res.services) {
      const price = effectivePrice(state, svc);
      const disabled = svc.tags.some((tag) => state.disabledServiceTags.includes(tag));
      const affordable = state.rubles >= price;
      const reason: EconomyError | undefined = disabled
        ? 'SERVICE_DISABLED'
        : affordable
          ? undefined
          : 'INSUFFICIENT_FUNDS';
      out.push({
        residentId: res.id,
        kind: 'service',
        id: svc.id,
        label: svc.label,
        effectivePrice: price,
        affordable,
        offerable: !disabled,
        ...(reason ? { reason } : {}),
      });
    }
    for (const fav of res.favors) {
      const rel = state.relationships[res.id] ?? t.startingRelationship;
      const gated = rel < t.refusalFloor || rel < fav.minRelationship;
      const reason: EconomyError | undefined = !broke ? 'NOT_BROKE' : gated ? 'FAVOR_REFUSED' : undefined;
      out.push({
        residentId: res.id,
        kind: 'favor',
        id: fav.id,
        label: fav.label,
        effectivePrice: null,
        affordable: false,
        offerable: broke && !gated,
        ...(reason ? { reason } : {}),
      });
    }
  }
  return out;
}
