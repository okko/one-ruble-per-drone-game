/**
 * The Playing scene (docs/areas/01-gameplay-engine.md §3.1, §request). A THIN shell over the pure
 * engine: it owns the run's `GameState`, drives `engine.step` each tick, and renders the run through the
 * Three.js world view + the DOM HUD overlay (the old Canvas-2D in-game UI is gone). All gameplay logic
 * stays in `src/systems/combat/*`; this file adapts the Scene/Input edges and owns the SHOOTING ⇄
 * INTERIOR mode machine:
 *  - SHOOTING: aim + fire at the drones (pointer/touch or A/D + Space), exactly as before.
 *  - INTERIOR: press E to leave the firing post and step down inside the tower; ↑/↓ walk floors, ←/→
 *    pick a resident interaction, ENTER buys/begs it (routed as a `residentIntent`); stepping back up
 *    onto the roof (or E again) returns to SHOOTING. The sim keeps running, so being inside during a
 *    wave is a real risk — that is why drones arrive in spaced waves with a siren.
 * It does NOT handle `gameOver` (the global `wireGameOver` routes to the GameOver scene).
 */
import { createGameState } from './create-game-state';
import { createEngine } from '../systems/combat/engine';
import { IDLE_INTENT } from '../systems/combat/types';
import type { Engine } from '../systems/combat/engine';
import type { PlayerIntent } from '../systems/combat/types';
import type { AudioEngineImpl } from '../audio/engine';
import type { Scene } from './scene';
import type { SystemContext } from '../core/system-context';
import type { InputEvent } from '../input/input';
import type { ResidentDef, ServiceDef, FavorDef, ReliefRequest, Consequence } from '../content/residents';
import type { MeterKey } from '../types/meter-key';
import type { GameState } from './game-state';
import type { Vec2 } from '../core/math';
import type { ThreeView } from '../render/three/view';
import type { GameOverlay } from '../ui/game-overlay';
import type { HudEconomy, SettingsView, ResidentMenuEntry } from '../ui/hud/types';
import type { InteriorOption, PlayingViewState, PlayMode, TransactionFeedback, FeedbackLine } from './playing-view';

const TOP_FLOOR = 32; // the firing-post roof sits atop floor 32
const BOTTOM_FLOOR = 21; // residents occupy the top 12 floors (21–32)

const NAV_UP = new Set(['ArrowUp', 'KeyW']);
const NAV_DOWN = new Set(['ArrowDown', 'KeyS']);
const NAV_LEFT = new Set(['ArrowLeft', 'KeyA']);
const NAV_RIGHT = new Set(['ArrowRight', 'KeyD']);
const CONFIRM = new Set(['Enter', 'NumpadEnter', 'Space']);

/** What the buy/beg listeners record when the engine applies a transaction (null until it does). */
type PendingTxn = { kind: 'service'; cost: number } | { kind: 'favor' } | null;

// ---- Transaction-result copy --------------------------------------------------------------------
// Turns a chosen option's content (relief / side effects / consequence) into the short, human lines the
// result dialog pops. Pure formatting — no gameplay numbers are recomputed here (the engine already
// applied the real transaction); these describe WHAT it did so "buy" stops feeling like a no-op.
const METER_FB: Record<MeterKey, { icon: string; name: string }> = {
  sleep: { icon: '😴', name: 'Fatigue' },
  hunger: { icon: '🍞', name: 'Hunger' },
  thirst: { icon: '💧', name: 'Thirst' },
  vice: { icon: '🚬', name: 'Craving' },
  poo: { icon: '💩', name: 'Bladder' },
};

// `delta` is the signed change to the meter VALUE (meters rise toward crisis), so a drop reads as relief
// (green ↓) and a rise as a downside (red ↑) — matching how the HUD bars fill.
function meterLine(meter: MeterKey, delta: number): FeedbackLine {
  const m = METER_FB[meter];
  const worse = delta > 0;
  return { icon: m.icon, text: `${m.name} ${worse ? '+' : '−'}${Math.abs(Math.round(delta))}`, tone: worse ? 'bad' : 'good' };
}

function reliefLines(r: ReliefRequest): FeedbackLine[] {
  const out: FeedbackLine[] = [meterLine(r.meter, -r.amount)]; // amount>0 ⇒ the meter drops (relief)
  if (r.secondary) out.push(meterLine(r.secondary.meter, r.secondary.amount)); // signed: + worsens, − relieves
  if (r.effect === 'drunk') out.push({ icon: '🥴', text: 'A pleasant haze', tone: 'neutral' });
  else if (r.effect === 'coffee') out.push({ icon: '⚡', text: 'Wired and jittery', tone: 'neutral' });
  return out;
}

function consequenceLine(c: Consequence): FeedbackLine {
  switch (c.kind) {
    case 'debt':
      return { icon: '📉', text: `Owe ₽${c.amount} later`, tone: 'bad' };
    case 'chore':
      return { icon: '🧹', text: `A ${c.durationSeconds}s chore owed`, tone: 'bad' };
    case 'reputation':
      return { icon: '📉', text: `−${c.amount} reputation`, tone: 'bad' };
    case 'degraded':
      return { icon: '💢', text: 'Weaker than paying for it', tone: 'bad' };
  }
}

/** What a paid service produces: meter relief + side effects, or a special non-meter outcome by tag. */
function serviceOutcome(svc: ServiceDef): FeedbackLine[] {
  const out: FeedbackLine[] = svc.relief ? reliefLines(svc.relief) : [];
  if (svc.tags.includes('gun')) out.push({ icon: '🔧', text: 'Gun jam cleared', tone: 'good' });
  if (svc.tags.includes('repair')) out.push({ icon: '🏗️', text: 'City block patched up', tone: 'good' });
  return out;
}

/** What a begged favor produces: the (free but) degraded relief or jam-clear, then its one downside. */
function favorOutcome(fav: FavorDef): FeedbackLine[] {
  // A relief-less favor is the on-credit jam clear (engine enacts it); otherwise it grants meter relief.
  const out: FeedbackLine[] = fav.relief ? reliefLines(fav.relief) : [{ icon: '🔧', text: 'Gun jam cleared', tone: 'good' }];
  out.push(consequenceLine(fav.consequence));
  return out;
}

export interface PlayingSceneOptions {
  /** Per-tick diagnostic sink used by the cross-browser e2e (`__combat`). */
  onState?: (gs: GameState) => void;
  /** Audio engine (area 06): advanced per tick + told the active scene. */
  audio?: Pick<AudioEngineImpl, 'update' | 'setScene'>;
  /** The Three.js world view (omitted in headless tests — the engine still runs). */
  view?: ThreeView | undefined;
  /** The DOM HUD + interaction overlay (omitted in headless tests). */
  overlay?: GameOverlay | undefined;
  /** Economy selector for the resident-interaction menu (omitted in bare-engine tests). */
  economy?: HudEconomy;
  /** Settings projection (resident-panel key binding + pause-while-visiting accessibility). */
  settings?: SettingsView;
}

export function createPlayingScene(opts: PlayingSceneOptions = {}): Scene {
  let gs: GameState | null = null;
  let engine: Engine | null = null;
  const occupantByFloor = new Map<number, ResidentDef>();

  // Buffered shooting input.
  let aimTarget: Vec2 | null = null;
  let fireHeld = false;
  let left = false;
  let right = false;

  // Interaction state.
  let mode: PlayMode = 'shooting';
  let floor = TOP_FLOOR;
  let selected = 0;
  let cachedOptions: InteriorOption[] = [];

  // Last-confirm feedback for the result dialog. `nonce` bumps per confirm so the overlay re-pops even
  // on a repeat. `pendingTxn` is set synchronously by the buy/beg event listeners during a confirm's
  // emit and read straight after — it's how we tell an applied transaction from one the engine rejected.
  let feedback: TransactionFeedback | null = null;
  let feedbackNonce = 0;
  let pendingTxn: PendingTxn = null;
  const txnOffs: Array<() => void> = [];

  function setFeedback(f: Omit<TransactionFeedback, 'nonce'>): void {
    feedbackNonce += 1;
    feedback = { ...f, nonce: feedbackNonce };
  }
  // Reset via a helper (not an inline `pendingTxn = null`) so control-flow analysis keeps the full
  // `PendingTxn` type at the read below — the listeners that flip it run during the synchronous emit.
  function armTxn(): void {
    pendingTxn = null;
  }

  const panelKey = (): string => opts.settings?.residentPanelKey ?? 'KeyE';

  function currentResidentEntry(): ResidentMenuEntry | null {
    const occ = occupantByFloor.get(floor);
    if (!occ || !gs || !opts.economy) return null;
    return opts.economy.getAvailableInteractions(gs).residents.find((r) => r.residentId === occ.id) ?? null;
  }

  function buildOptions(): InteriorOption[] {
    const entry = currentResidentEntry();
    if (!entry) return [];
    return [
      ...entry.services.map((o) => ({ residentId: entry.residentId, kind: 'service' as const, option: o })),
      ...entry.favors.map((o) => ({ residentId: entry.residentId, kind: 'favor' as const, option: o })),
    ];
  }

  function enterInterior(): void {
    mode = 'interior';
    floor = TOP_FLOOR;
    selected = 0;
    feedback = null; // each visit starts with a clean counter
    // Stepping inside drops the trigger so the gun never sticks on while we walk down.
    fireHeld = false;
    left = false;
    right = false;
    opts.view?.setCameraState('interior'); // the director cranes down the tower face
  }
  function backToShooting(): void {
    mode = 'shooting';
    floor = TOP_FLOOR;
    feedback = null;
    opts.view?.setCameraState('shooting');
  }

  // Routed through the event bus exactly like the old intercom panel; the engine consumes the intent.
  let emitIntent: (e: { kind: 'buyService'; residentId: string; serviceId: string } | { kind: 'begFavor'; residentId: string; favorId: string }) => void = () => {};

  function confirmSelection(): void {
    const choice = cachedOptions[selected];
    if (!choice || !gs) return;
    const resident = occupantByFloor.get(floor);
    const who = resident?.name ?? '';
    const title = choice.option.label;

    // Greyed entries can't be bought — pop the reason rather than silently doing nothing.
    if (choice.option.disabledReason !== undefined) {
      setFeedback({ ok: false, kind: choice.kind, who, title, lines: [{ icon: '🚫', text: choice.option.disabledReason, tone: 'bad' }] });
      return;
    }

    armTxn(); // a buy/beg listener flips pendingTxn on success while the (synchronous) intent dispatches
    if (choice.kind === 'service') {
      emitIntent({ kind: 'buyService', residentId: choice.residentId, serviceId: choice.option.id });
    } else {
      emitIntent({ kind: 'begFavor', residentId: choice.residentId, favorId: choice.option.id });
    }

    // The bus is synchronous, so the engine has now applied (and announced) — or rejected — the intent.
    const txn = pendingTxn;
    if (txn === null) {
      // Rejected. The only ungated path here is an unaffordable service (favors/disabled rows are caught above).
      const reason =
        choice.kind === 'service' && choice.option.affordable === false
          ? `Need ₽${choice.option.costRubles ?? '?'} — can't afford it`
          : 'No deal right now';
      setFeedback({ ok: false, kind: choice.kind, who, title, lines: [{ icon: '🚫', text: reason, tone: 'bad' }] });
      return;
    }

    const lines: FeedbackLine[] = [];
    if (choice.kind === 'service') {
      const svc = resident?.services.find((s) => s.id === choice.option.id);
      lines.push({ icon: '💸', text: `−₽${txn.kind === 'service' ? txn.cost : 0}`, tone: 'cost' });
      if (svc) lines.push(...serviceOutcome(svc));
    } else {
      const fav = resident?.favors.find((f) => f.id === choice.option.id);
      lines.push({ icon: '🤝', text: 'Begged a favor — no rubles', tone: 'neutral' });
      if (fav) lines.push(...favorOutcome(fav));
    }
    setFeedback({ ok: true, kind: choice.kind, who, title, lines });
  }

  function handleInteriorKey(code: string): void {
    if (NAV_DOWN.has(code)) {
      floor = Math.max(BOTTOM_FLOOR, floor - 1);
      selected = 0;
      feedback = null; // walked to another door — clear the last receipt
    } else if (NAV_UP.has(code)) {
      const next = floor + 1;
      if (next > TOP_FLOOR) backToShooting();
      else {
        floor = next;
        selected = 0;
        feedback = null;
      }
    } else if (NAV_LEFT.has(code)) {
      selected = Math.max(0, selected - 1);
    } else if (NAV_RIGHT.has(code)) {
      selected = Math.min(Math.max(0, cachedOptions.length - 1), selected + 1);
    } else if (CONFIRM.has(code)) {
      confirmSelection();
    }
  }

  function viewState(): PlayingViewState {
    cachedOptions = mode === 'interior' ? buildOptions() : [];
    if (selected >= cachedOptions.length) selected = Math.max(0, cachedOptions.length - 1);
    const occ = occupantByFloor.get(floor);
    const w = gs?.combat.waves;
    const sirenActive = w?.phase === 'siren';
    const secondsUntilWave = !w || w.phase === 'active' ? null : Math.max(0, w.timer);
    return {
      mode,
      floor,
      topFloor: TOP_FLOOR,
      bottomFloor: BOTTOM_FLOOR,
      storeys: TOP_FLOOR,
      occupants: [...occupantByFloor].map(([f, r]) => ({ floor: f, id: r.id, name: r.name })),
      currentResidentId: occ?.id ?? null,
      currentResidentName: occ?.name ?? null,
      options: cachedOptions,
      selected,
      feedback,
      siren: { active: sirenActive, secondsUntilWave },
    };
  }

  return {
    enter(_params: void, ctx: SystemContext): void {
      gs = createGameState(ctx.content, ctx.rng.getState().seed);
      engine = createEngine(gs, ctx);
      occupantByFloor.clear();
      for (const r of ctx.content.economy.roster) occupantByFloor.set(r.floor, r);
      emitIntent = (e): void => ctx.events.emit('residentIntent', e);
      // Watch the engine's announcement of an APPLIED buy/beg, so a confirm can tell success (a result
      // dialog) from a rejection (the engine stays silent). Cleared + re-armed each run.
      txnOffs.forEach((off) => off());
      txnOffs.length = 0;
      txnOffs.push(
        ctx.events.on('serviceBought', (p) => {
          pendingTxn = { kind: 'service', cost: p.cost };
        }),
        ctx.events.on('favorBegged', () => {
          pendingTxn = { kind: 'favor' };
        }),
      );
      mode = 'shooting';
      floor = TOP_FLOOR;
      selected = 0;
      feedback = null;
      opts.audio?.setScene('Playing');
      opts.overlay?.setVisible(true);
      opts.view?.setVisible(true);
      opts.view?.startIntro(); // opening fly-up from the ground floor to the rooftop post
    },

    update(dt: number): void {
      if (!gs || !engine) return;
      // Accessibility: optionally freeze the sim while inside (otherwise a wave can hit while visiting).
      const paused = mode === 'interior' && (opts.settings?.pauseWhilePanelOpen ?? false);
      if (!paused) {
        const intent: PlayerIntent =
          mode === 'interior'
            ? IDLE_INTENT
            : { aimTarget, rotateDir: (right ? 1 : 0) - (left ? 1 : 0), fireHeld };
        engine.step(dt, intent);
      }
      opts.audio?.update(gs, dt);
      opts.onState?.(gs);
    },

    onInput(e: InputEvent): void {
      if (e.type === 'key') {
        if (e.code === panelKey()) {
          if (e.down) {
            if (mode === 'shooting') enterInterior();
            else backToShooting();
          }
          return;
        }
        if (mode === 'interior') {
          if (e.down) handleInteriorKey(e.code);
          return; // interior consumes all keys (never steers the gun)
        }
        if (e.code === 'Space') fireHeld = e.down;
        else if (NAV_LEFT.has(e.code)) left = e.down;
        else if (NAV_RIGHT.has(e.code)) right = e.down;
        return;
      }
      if (mode === 'interior') return; // ignore aim/fire while inside
      switch (e.type) {
        case 'aim':
          aimTarget = e.world;
          break;
        case 'pointer':
          if (e.down) aimTarget = e.world;
          break;
        case 'fireDown':
          fireHeld = true;
          break;
        case 'fireUp':
          fireHeld = false;
          break;
      }
    },

    render(alpha: number): void {
      if (!gs) return;
      const vs = viewState();
      opts.view?.render(gs, alpha, vs);
      opts.overlay?.update(gs, vs);
    },

    exit(): void {
      engine?.dispose();
      engine = null;
      txnOffs.forEach((off) => off());
      txnOffs.length = 0;
      opts.audio?.setScene('MainMenu');
      opts.overlay?.setVisible(false);
      opts.view?.setVisible(false);
      gs = null;
    },
  };
}
