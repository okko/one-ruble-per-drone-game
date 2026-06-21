import { describe, it, expect } from 'vitest';
import {
  createEconomyState,
  bankIncome,
  handleDroneDestroyed,
  buyService,
  begFavor,
  updateEconomy,
  applyIncidentFlags,
  getAvailableInteractions,
  effectivePrice,
  netWorth,
} from './economy';
import type { EconomyContext, ReliefSink } from './economy';
import { createTestContext } from '../test-support/context';
import { ECONOMY_TUNABLES } from '../content/residents';
import type { ReliefRequest, ResidentDef } from '../content/residents';
import type { IncidentFlags } from '../state/game-state';
import type { GameEvents } from '../core/events';

interface ReliefCall {
  req: ReliefRequest;
  q: number | undefined;
}

function setup() {
  const base = createTestContext();
  const reliefCalls: ReliefCall[] = [];
  const sink: ReliefSink = (req, q) => reliefCalls.push({ req, q });
  const ectx: EconomyContext = { ...base, applyRelief: sink };
  const events: { rubles: GameEvents['rublesChanged'][]; bought: GameEvents['serviceBought'][]; begged: GameEvents['favorBegged'][]; order: string[] } = {
    rubles: [],
    bought: [],
    begged: [],
    order: [],
  };
  base.events.on('rublesChanged', (p) => {
    events.rubles.push(p);
    events.order.push('rublesChanged');
  });
  base.events.on('serviceBought', (p) => {
    events.bought.push(p);
    events.order.push('serviceBought');
  });
  base.events.on('favorBegged', (p) => {
    events.begged.push(p);
    events.order.push('favorBegged');
  });
  const state = createEconomyState(base.content);
  return { ctx: base, ectx, reliefCalls, events, state };
}

describe('economy: income & banking', () => {
  it('1. a player kill banks +1 and emits rublesChanged; a non-player kill does nothing', () => {
    const { ctx, state, events } = setup();
    const after = handleDroneDestroyed(state, { byPlayer: true }, ctx);
    expect(after.rubles).toBe(1);
    expect(events.rubles).toEqual([{ delta: 1, total: 1 }]);

    const noop = handleDroneDestroyed(after, { byPlayer: false }, ctx);
    expect(noop).toBe(after); // unchanged reference
    expect(events.rubles).toHaveLength(1); // no new event
  });

  it('7. income repays debt before banking; clearing debt grants a reputation bump', () => {
    const { ctx, state } = setup();
    const inDebt = { ...state, debt: 5, reputation: 50 };
    let s = inDebt;
    for (let i = 0; i < 3; i++) s = bankIncome(s, 1, ctx);
    expect(s).toMatchObject({ debt: 2, rubles: 0 });
    for (let i = 0; i < 2; i++) s = bankIncome(s, 1, ctx);
    expect(s).toMatchObject({ debt: 0, rubles: 0 });
    expect(s.reputation).toBeGreaterThan(50); // bump on the clearing payment
    s = bankIncome(s, 1, ctx);
    expect(s).toMatchObject({ debt: 0, rubles: 1 });
  });

  it('emits rublesChanged with delta 0 when income goes entirely to debt', () => {
    const { ctx, state, events } = setup();
    bankIncome({ ...state, debt: 5 }, 1, ctx);
    expect(events.rubles).toEqual([{ delta: 0, total: 0 }]);
  });

  it('netWorth is rubles minus debt', () => {
    const { state } = setup();
    expect(netWorth({ ...state, rubles: 3, debt: 0 })).toBe(3);
    expect(netWorth({ ...state, rubles: 0, debt: 4 })).toBe(-4);
  });
});

describe('economy: buy a service', () => {
  it('2. deducts the price, applies the exact relief, raises relationship, emits serviceBought', () => {
    const { ectx, reliefCalls, events, state } = setup();
    const res = buyService({ ...state, rubles: 10 }, 'babushka', 'stew', ectx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.rubles).toBe(6); // 10 - 4
    expect(res.value.relationships.babushka).toBe(62); // 60 + 2
    expect(reliefCalls).toEqual([{ req: { meter: 'hunger', amount: 45 }, q: 1 }]);
    expect(events.bought).toEqual([{ residentId: 'babushka', service: 'stew', cost: 4 }]);
  });

  it('3. cannot buy without enough funds — no change, no event, no relief', () => {
    const { ectx, reliefCalls, events, state } = setup();
    const res = buyService({ ...state, rubles: 3 }, 'babushka', 'stew', ectx); // stew is 4
    expect(res).toEqual({ ok: false, error: 'INSUFFICIENT_FUNDS' });
    expect(reliefCalls).toHaveLength(0);
    expect(events.bought).toHaveLength(0);
  });

  it('4. cannot buy while holding only debt (rubles 0, debt > 0)', () => {
    const { ectx, state } = setup();
    const res = buyService({ ...state, rubles: 0, debt: 8 }, 'babushka', 'stew', ectx);
    expect(res).toEqual({ ok: false, error: 'INSUFFICIENT_FUNDS' });
  });

  it('11. price multiplier scales the effective price (rounded up) and the funds check', () => {
    const { ectx, state, ctx } = setup();
    const stew = ctx.content.economy.roster.find((r) => r.id === 'babushka')?.services[0];
    expect(stew).toBeDefined();
    if (!stew) return;
    const spiked = { ...state, rubles: 7, priceMultiplier: 2 };
    expect(effectivePrice(spiked, stew)).toBe(8); // ceil(4 * 2)
    expect(buyService(spiked, 'babushka', 'stew', ectx)).toEqual({ ok: false, error: 'INSUFFICIENT_FUNDS' });
    expect(buyService({ ...spiked, rubles: 8 }, 'babushka', 'stew', ectx).ok).toBe(true);
  });

  it('12. a disabled service tag blocks buying and is marked not-offerable', () => {
    const { ectx, state, ctx } = setup();
    const disabled = { ...state, rubles: 10, disabledServiceTags: ['toilet'] };
    expect(buyService(disabled, 'plumber', 'toilet', ectx)).toEqual({ ok: false, error: 'SERVICE_DISABLED' });
    const toiletOpt = getAvailableInteractions(disabled, ctx.content).find(
      (o) => o.residentId === 'plumber' && o.id === 'toilet',
    );
    expect(toiletOpt?.offerable).toBe(false);
    expect(toiletOpt?.reason).toBe('SERVICE_DISABLED');
  });

  it('a gun-tagged service has no meter relief but still completes and emits', () => {
    const { ectx, reliefCalls, events, state } = setup();
    const res = buyService({ ...state, rubles: 10 }, 'mechanic', 'clearjam', ectx);
    expect(res.ok).toBe(true);
    expect(reliefCalls).toHaveLength(0); // no meter relief; Engine clears the jam
    expect(events.bought).toEqual([{ residentId: 'mechanic', service: 'clearjam', cost: 4 }]);
  });
});

describe('economy: beg a favor', () => {
  it('5. debt favor: applies relief and increases debt', () => {
    const { ectx, reliefCalls, events, state } = setup();
    const res = begFavor(state, 'oligarch', 'loan', ectx); // broke by default
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.debt).toBe(10);
    expect(reliefCalls[0]?.req).toEqual({ meter: 'sleep', amount: 40 });
    expect(events.begged).toEqual([{ residentId: 'oligarch', favor: 'loan', consequence: 'debt' }]);
  });

  it('5. chore favor: schedules the chore and applies relief', () => {
    const { ectx, reliefCalls, state } = setup();
    const res = begFavor(state, 'chef', 'scraps', ectx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.activeChore).toEqual({ residentId: 'chef', secondsLeft: 12 });
    expect(reliefCalls[0]?.req).toEqual({ meter: 'hunger', amount: 25 });
  });

  it('5. reputation favor: lowers reputation and relationship by the stated amount', () => {
    const { ectx, state } = setup();
    const res = begFavor({ ...state, reputation: 50 }, 'plumber', 'bucket', ectx); // amount 10
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.reputation).toBe(40);
    expect(res.value.relationships.plumber).toBe(50); // 60 - 10
  });

  it('5. degraded favor: scales the relief and applies the side effect as secondary', () => {
    const { ectx, reliefCalls, events, state } = setup();
    const res = begFavor(state, 'babushka', 'leftovers', ectx); // rel 60 -> q 1.0
    expect(res.ok).toBe(true);
    expect(reliefCalls[0]).toEqual({
      req: { meter: 'hunger', amount: 45 * 0.6, secondary: { meter: 'poo', amount: 12 } },
      q: 1,
    });
    expect(events.begged[0]?.consequence).toBe('degraded');
  });

  it('6. cannot beg while holding rubles (NOT_BROKE)', () => {
    const { ectx, state } = setup();
    const res = begFavor({ ...state, rubles: 3 }, 'oligarch', 'loan', ectx);
    expect(res).toEqual({ ok: false, error: 'NOT_BROKE' });
  });

  it('8. reputation gating: refused below minRelationship and below the floor', () => {
    const { ectx, state } = setup();
    const low = { ...state, relationships: { ...state.relationships, babushka: 25 } }; // < minRel 30
    expect(begFavor(low, 'babushka', 'leftovers', ectx)).toEqual({ ok: false, error: 'FAVOR_REFUSED' });
    const ok = { ...state, relationships: { ...state.relationships, babushka: 35 } };
    expect(begFavor(ok, 'babushka', 'leftovers', ectx).ok).toBe(true);
    const floored = { ...state, relationships: { ...state.relationships, priest: 10 } }; // < floor 15
    expect(begFavor(floored, 'priest', 'charity', ectx)).toEqual({ ok: false, error: 'FAVOR_REFUSED' });
  });

  it('9. quality degradation: qualityFactor passed to the sink scales with relationship', () => {
    const { ectx, reliefCalls, state } = setup();
    begFavor({ ...state, relationships: { ...state.relationships, chef: 60 } }, 'chef', 'scraps', ectx);
    expect(reliefCalls[0]?.q).toBeCloseTo(1.0, 5);
    begFavor({ ...state, relationships: { ...state.relationships, chef: 30 } }, 'chef', 'scraps', ectx);
    expect(reliefCalls[1]?.q).toBeCloseTo(0.5, 5);
  });
});

describe('economy: upkeep & incident hooks', () => {
  it('10. drift moves relationship toward 60 and reputation toward 50', () => {
    const { ctx, state } = setup();
    const lowRel = { ...state, reputation: 30, relationships: { ...state.relationships, babushka: 40 } };
    const drifted = updateEconomy(lowRel, 1, ctx);
    expect(drifted.relationships.babushka).toBeGreaterThan(40);
    expect(drifted.relationships.babushka).toBeLessThanOrEqual(60);
    expect(drifted.reputation).toBeGreaterThan(30);

    const highRel = { ...state, reputation: 80, relationships: { ...state.relationships, babushka: 80 } };
    expect(updateEconomy(highRel, 1, ctx).relationships.babushka).toBeLessThan(80);
  });

  it('14. chore countdown decrements and clears at zero', () => {
    const { ctx, state } = setup();
    const choring = { ...state, activeChore: { residentId: 'chef', secondsLeft: 2 } };
    const mid = updateEconomy(choring, 1, ctx);
    expect(mid.activeChore).toEqual({ residentId: 'chef', secondsLeft: 1 });
    const done = updateEconomy(mid, 1, ctx);
    expect(done.activeChore).toBeNull();
  });

  it('11/incident: applyIncidentFlags mirrors price multiplier and disabled tags, then resets', () => {
    const { state } = setup();
    const shortage: IncidentFlags = baseFlags({ servicePriceMultiplier: 2 });
    const spiked = applyIncidentFlags(state, shortage);
    expect(spiked.priceMultiplier).toBe(2);

    const elevator = applyIncidentFlags(state, baseFlags({ servicesDisabled: true }));
    expect(elevator.disabledServiceTags).toContain('delivery');

    const pipe = applyIncidentFlags(state, baseFlags({ toiletBlocked: true }));
    expect(pipe.disabledServiceTags).toContain('toilet');

    const cleared = applyIncidentFlags(spiked, baseFlags({}));
    expect(cleared.priceMultiplier).toBe(1);
    expect(cleared.disabledServiceTags).toEqual([]);
  });
});

describe('economy: atomicity & availability', () => {
  it('13. a failed transaction leaves state byte-for-byte unchanged with no side effects', () => {
    const { ectx, reliefCalls, events, state } = setup();
    const start = { ...state, rubles: 2 };
    const snapshot = structuredClone(start);
    expect(buyService(start, 'babushka', 'stew', ectx).ok).toBe(false); // 2 < 4
    expect(start).toEqual(snapshot);
    expect(reliefCalls).toHaveLength(0);
    expect(events.order).toHaveLength(0);
  });

  it('16. availability reflects affordability, brokeness, gating, and disabled tags', () => {
    const { ctx, state } = setup();
    const flush = { ...state, rubles: 5, disabledServiceTags: ['delivery'] };
    const opts = getAvailableInteractions(flush, ctx.content);

    const stew = opts.find((o) => o.id === 'stew');
    expect(stew).toMatchObject({ kind: 'service', effectivePrice: 4, affordable: true, offerable: true });

    const pelmeni = opts.find((o) => o.id === 'pelmeni'); // delivery tag, disabled
    expect(pelmeni).toMatchObject({ offerable: false, reason: 'SERVICE_DISABLED' });

    const loan = opts.find((o) => o.id === 'loan'); // favor; not broke
    expect(loan).toMatchObject({ kind: 'favor', effectivePrice: null, offerable: false, reason: 'NOT_BROKE' });

    const brokeOpts = getAvailableInteractions({ ...state, rubles: 0 }, ctx.content);
    expect(brokeOpts.find((o) => o.id === 'loan')?.offerable).toBe(true); // broke + rel 60 >= minRel 0
  });

  it('17. end-to-end: five kills bank 5 rubles, then a 4-ruble service leaves 1 ruble', () => {
    const { ctx, ectx, reliefCalls, events, state } = setup();
    let s = state;
    for (let i = 0; i < 5; i++) s = handleDroneDestroyed(s, { byPlayer: true }, ctx);
    expect(s.rubles).toBe(5);
    const res = buyService(s, 'babushka', 'stew', ectx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.rubles).toBe(1);
    expect(reliefCalls).toEqual([{ req: { meter: 'hunger', amount: 45 }, q: 1 }]);
    expect(events.order).toEqual([
      'rublesChanged',
      'rublesChanged',
      'rublesChanged',
      'rublesChanged',
      'rublesChanged',
      'serviceBought',
    ]);
  });

  it('createEconomyState seeds relationships from the roster at the starting value', () => {
    const { ctx, state } = setup();
    expect(state.rubles).toBe(0);
    expect(state.reputation).toBe(50);
    for (const r of ctx.content.economy.roster) expect(state.relationships[r.id]).toBe(60);
  });
});

describe('economy: degraded-relief edge cases', () => {
  const lab: ResidentDef = {
    id: 'lab',
    name: 'Lab',
    floor: 0,
    personality: 'test fixture',
    services: [],
    favors: [
      // degraded with a base effect marker + base.secondary but no sideEffect (fallback path).
      {
        id: 'fancy',
        label: 'Fancy',
        minRelationship: 0,
        relief: { meter: 'vice', amount: 50, secondary: { meter: 'sleep', amount: 5 }, effect: 'coffee' },
        consequence: { kind: 'degraded', reliefScale: 0.5 },
      },
      // degraded favor with no relief at all (the !base path; no relief call).
      { id: 'empty', label: 'Empty', minRelationship: 0, consequence: { kind: 'degraded', reliefScale: 0.5 } },
      // plain degraded: no secondary, no effect, no sideEffect.
      {
        id: 'plain',
        label: 'Plain',
        minRelationship: 0,
        relief: { meter: 'hunger', amount: 30 },
        consequence: { kind: 'degraded', reliefScale: 0.5 },
      },
    ],
  };

  function labSetup() {
    const base = createTestContext({ content: { economy: { roster: [lab], tunables: ECONOMY_TUNABLES } } });
    const reliefCalls: ReliefCall[] = [];
    const ectx: EconomyContext = { ...base, applyRelief: (req, q) => reliefCalls.push({ req, q }) };
    return { ectx, reliefCalls, state: createEconomyState(base.content) };
  }

  it('falls back to the base secondary and carries the base effect marker', () => {
    const { ectx, reliefCalls, state } = labSetup();
    expect(begFavor(state, 'lab', 'fancy', ectx).ok).toBe(true);
    expect(reliefCalls[0]?.req).toEqual({
      meter: 'vice',
      amount: 25, // 50 * 0.5
      secondary: { meter: 'sleep', amount: 5 },
      effect: 'coffee',
    });
  });

  it('a degraded favor with no relief applies no relief but still incurs the consequence', () => {
    const { ectx, reliefCalls, state } = labSetup();
    expect(begFavor(state, 'lab', 'empty', ectx).ok).toBe(true);
    expect(reliefCalls).toHaveLength(0);
  });

  it('a plain degraded relief has no secondary and no effect', () => {
    const { ectx, reliefCalls, state } = labSetup();
    expect(begFavor(state, 'lab', 'plain', ectx).ok).toBe(true);
    expect(reliefCalls[0]?.req).toEqual({ meter: 'hunger', amount: 15 });
  });
});

function baseFlags(over: Partial<IncidentFlags>): IncidentFlags {
  return {
    toiletBlocked: false,
    spawnRateMultiplier: 1,
    bossActive: false,
    gunJammed: false,
    blackout: 0,
    sleepGainMultiplier: 1,
    servicePriceMultiplier: 1,
    servicesDisabled: false,
    inputLocked: false,
    decoysActive: false,
    ...over,
  };
}
