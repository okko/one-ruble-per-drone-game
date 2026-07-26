/**
 * The in-game HUD + resident-interaction overlay (§request — replaces the Canvas-2D HUD). A DOM/CSS
 * layer over the Three.js world canvas, so text/bars stay crisp at the iPhone-17 native resolution. It
 * READS `GameState` + `PlayingViewState` each frame and reflects them; the only player action it routes
 * is the resident interaction, which the Playing scene emits as a `residentIntent` (this overlay just
 * displays the menu the scene drives via keyboard). It mutates no gameplay state.
 *
 * Layout: meters top-left, score/combo top-right, the wave/siren banner top-centre, rubles bottom-left,
 * the shared city-integrity bar bottom-centre, a controls hint, and — in interior mode — a panel for the
 * current floor's resident (name + buy/beg options with the selected row highlighted).
 */
import './styles/tokens.css';
import { METER_DISPLAY_ORDER } from './hud/theme';
import type { Content } from '../content/loader';
import type { GameState } from '../state/game-state';
import type { PlayingViewState, FeedbackTone } from '../state/playing-view';
import type { MeterKey } from '../types/meter-key';

export interface GameOverlay {
  update(gs: GameState, vs: PlayingViewState): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

/**
 * Colours come from the design tokens, never from a hard-coded hex. Every value here is a `var()`
 * reference, so a token edit reaches the HUD without touching this file, and the HUD can never drift
 * away from the screens it sits next to.
 */
const T = {
  text: 'var(--c-text)',
  textMuted: 'var(--c-text-muted)',
  accent: 'var(--c-accent)',
  good: 'var(--c-good)',
  warn: 'var(--c-warn)',
  danger: 'var(--c-danger)',
  surface: 'var(--c-surface)',
  surfaceRaised: 'var(--c-surface-raised)',
  hairline: 'var(--c-hairline)',
} as const;

const METER_EMOJI: Record<MeterKey, string> = { sleep: '😴', hunger: '🍞', thirst: '💧', vice: '🚬', poo: '💩' };

const TONE_COLOR: Record<FeedbackTone, string> = {
  cost: T.accent,
  good: T.good,
  bad: T.danger,
  neutral: T.text,
};

// Quick CSS keyframes for the interactions: the transaction-result dialog pops in / fades out on its own
// (decoupled from the sim clock, so it still animates while the pause-on-visit accessibility option holds
// the engine), each result line slides in with a tiny stagger, and the rubles counter flashes on a spend.
const OVERLAY_CSS = `
@keyframes ggo-pop {
  0%   { opacity: 0; transform: translateX(-50%) translateY(10px) scale(0.9); }
  9%   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.04); }
  16%  { transform: translateX(-50%) translateY(0) scale(1); }
  78%  { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
  100% { opacity: 0; transform: translateX(-50%) translateY(-8px) scale(0.98); }
}
@keyframes ggo-rowin {
  from { opacity: 0; transform: translateX(-8px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes ggo-spend {
  0%   { transform: scale(1); }
  35%  { transform: scale(1.28); color: ${T.danger}; }
  100% { transform: scale(1); }
}`;

function injectOverlayCss(): void {
  if (typeof document === 'undefined' || document.getElementById('ggo-css')) return;
  const style = document.createElement('style');
  style.id = 'ggo-css';
  style.textContent = OVERLAY_CSS;
  document.head.appendChild(style);
}

function el(tag: string, style: Partial<CSSStyleDeclaration>, text?: string): HTMLElement {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

function fmtScore(n: number): string {
  return Math.max(0, Math.floor(n)).toString().padStart(8, '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function createGameOverlay(host: HTMLElement, content: Content): GameOverlay {
  const maxIntegrity = content.combat.postIntegrityMax;
  const warn = content.meters.warn;

  const root = el('div', {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    fontFamily: 'var(--font-numeric)',
    color: T.text,
    textShadow: 'var(--text-scrim)',
    zIndex: 'var(--z-overlay)',
    userSelect: 'none',
  });

  // ---- Meters (top-left) --------------------------------------------------------------------
  const metersBox = el('div', { position: 'absolute', top: '2vh', left: '2vh', display: 'grid', gap: '0.6vh' });
  const meterBars = new Map<MeterKey, HTMLElement>();
  for (const key of METER_DISPLAY_ORDER) {
    const row = el('div', { display: 'flex', alignItems: 'center', gap: '0.8vh' });
    row.appendChild(el('span', { fontSize: '2.4vh', width: '3vh' }, METER_EMOJI[key]));
    const track = el('div', { width: '18vh', height: '1.6vh', background: 'rgba(0,0,0,0.45)', border: `1px solid ${T.hairline}`, borderRadius: '2px', overflow: 'hidden' });
    const fill = el('div', { height: '100%', width: '0%', background: T.good, transition: 'width 0.1s linear' });
    track.appendChild(fill);
    row.appendChild(track);
    metersBox.appendChild(row);
    meterBars.set(key, fill);
  }
  root.appendChild(metersBox);

  // ---- Score + combo (top-right) ------------------------------------------------------------
  const scoreBox = el('div', { position: 'absolute', top: '2vh', right: '2vh', textAlign: 'right' });
  const scoreText = el('div', { fontSize: '3.4vh', fontWeight: '700', color: T.accent }, '00,000,000');
  const comboText = el('div', { fontSize: '2.2vh', color: T.text }, '×1');
  scoreBox.appendChild(scoreText);
  scoreBox.appendChild(comboText);
  root.appendChild(scoreBox);

  // ---- Wave / siren banner (top-centre) -----------------------------------------------------
  const banner = el('div', {
    position: 'absolute',
    top: '2vh',
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: '2.6vh',
    fontWeight: '700',
    padding: '0.6vh 1.6vh',
    borderRadius: '4px',
    textAlign: 'center',
  });
  root.appendChild(banner);

  // ---- Rubles (bottom-left) -----------------------------------------------------------------
  const rublesText = el('div', { position: 'absolute', bottom: '5vh', left: '2vh', fontSize: '3vh', color: T.accent }, '₽ 0');
  const debtText = el('div', { position: 'absolute', bottom: '2vh', left: '2vh', fontSize: '2.2vh', color: T.danger }, '');
  root.appendChild(rublesText);
  root.appendChild(debtText);

  // ---- City integrity (bottom-centre) -------------------------------------------------------
  const integBox = el('div', { position: 'absolute', bottom: '2vh', left: '50%', transform: 'translateX(-50%)', textAlign: 'center', width: '36vh' });
  integBox.appendChild(el('div', { fontSize: '1.8vh', letterSpacing: '0.2vh' }, 'CITY INTEGRITY'));
  const integTrack = el('div', { width: '100%', height: '2vh', background: 'rgba(0,0,0,0.5)', border: `1px solid ${T.hairline}`, borderRadius: '3px', overflow: 'hidden', marginTop: '0.4vh' });
  const integFill = el('div', { height: '100%', width: '100%', background: T.good, transition: 'width 0.2s linear' });
  integTrack.appendChild(integFill);
  integBox.appendChild(integTrack);
  root.appendChild(integBox);

  // ---- Controls hint (bottom-right) ---------------------------------------------------------
  const hint = el('div', { position: 'absolute', bottom: '2vh', right: '2vh', fontSize: '1.7vh', opacity: '0.85', textAlign: 'right' });
  root.appendChild(hint);

  // ---- Interior resident panel (centre) -----------------------------------------------------
  const panel = el('div', {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%,-50%)',
    minWidth: '40vh',
    maxWidth: '70vh',
    background: 'rgba(26,28,44,0.92)',
    border: `2px solid ${T.surfaceRaised}`,
    borderRadius: '6px',
    padding: '2vh',
    display: 'none',
  });
  const panelTitle = el('div', { fontSize: '2.8vh', fontWeight: '700', color: T.accent, marginBottom: '1vh' }, '');
  const panelList = el('div', { display: 'grid', gap: '0.6vh' });
  panel.appendChild(panelTitle);
  panel.appendChild(panelList);
  root.appendChild(panel);

  // ---- Transaction-result dialog (above the resident panel) ---------------------------------
  // A card in the same idiom as the resident panel that pops up when the player buys/begs, showing the
  // rubles spent and what the option produced (meter relief / side effects) — or why it was refused.
  injectOverlayCss();
  const fbCard = el('div', {
    position: 'absolute',
    top: '18%',
    left: '50%',
    transform: 'translateX(-50%)',
    minWidth: '34vh',
    maxWidth: '60vh',
    background: 'rgba(26,28,44,0.94)',
    border: `2px solid ${T.surfaceRaised}`,
    borderRadius: '6px',
    padding: '1.4vh 2vh',
    display: 'none',
    textAlign: 'left',
  });
  const fbTitle = el('div', { fontSize: '2.4vh', fontWeight: '700', color: T.accent }, '');
  const fbWho = el('div', { fontSize: '1.6vh', opacity: '0.75', marginBottom: '0.8vh' }, '');
  const fbLines = el('div', { display: 'grid', gap: '0.4vh' });
  fbCard.appendChild(fbTitle);
  fbCard.appendChild(fbWho);
  fbCard.appendChild(fbLines);
  root.appendChild(fbCard);

  host.appendChild(root);

  // Replay-tracking for the one-shot animations (see updateFeedback / the rubles pulse).
  let lastFeedbackNonce = -1;
  let lastRubles = 0;
  let justShown = true;

  function update(gs: GameState, vs: PlayingViewState): void {
    // Meters.
    for (const key of METER_DISPLAY_ORDER) {
      const fill = meterBars.get(key);
      if (!fill) continue;
      const v = Math.max(0, Math.min(100, gs.meters.values[key]));
      fill.style.width = `${v}%`;
      fill.style.background = gs.meters.inCrisis[key] ? T.danger : v >= warn[key] ? T.warn : T.good;
    }

    // Score + combo.
    scoreText.textContent = fmtScore(gs.scoring.score);
    comboText.textContent = `×${gs.scoring.multiplier}`;

    // Rubles + debt. Flash the counter the moment a purchase spends some (a quick "money just left" cue).
    const rubles = gs.economy.rubles;
    rublesText.textContent = `₽ ${rubles}`;
    if (justShown) justShown = false; // first frame of a run: adopt the balance without a spurious flash
    else if (rubles < lastRubles) {
      rublesText.style.animation = 'none';
      void rublesText.offsetWidth; // reflow so the animation restarts on a repeat spend
      rublesText.style.animation = 'ggo-spend 0.5s ease-out';
    }
    lastRubles = rubles;
    debtText.textContent = gs.economy.debt > 0 ? `DEBT ₽-${gs.economy.debt}` : '';

    // City integrity.
    const frac = Math.max(0, Math.min(1, gs.combat.postIntegrity / maxIntegrity));
    integFill.style.width = `${frac * 100}%`;
    integFill.style.background = frac > 0.5 ? T.good : frac > 0.25 ? T.warn : T.danger;

    // Wave / siren banner.
    const phase = gs.combat.waves.phase;
    if (vs.siren.active) {
      const secs = Math.max(0, Math.ceil(vs.siren.secondsUntilWave ?? 0));
      banner.textContent = `🚨 AIR RAID — INCOMING ${secs}s`;
      banner.style.background = T.danger;
      banner.style.color = T.text;
      banner.style.opacity = Math.sin(gs.time.shiftSeconds * 8) > 0 ? '1' : '0.55';
    } else if (phase === 'active') {
      banner.textContent = `WAVE ${gs.combat.waves.index}`;
      banner.style.background = 'rgba(0,0,0,0.4)';
      banner.style.color = T.text;
      banner.style.opacity = '1';
    } else {
      const secs = Math.max(0, Math.ceil(vs.siren.secondsUntilWave ?? 0));
      banner.textContent = `NEXT WAVE IN ${secs}s — visit residents`;
      banner.style.background = 'rgba(0,0,0,0.35)';
      banner.style.color = T.good;
      banner.style.opacity = '1';
    }

    // Controls hint + interior panel.
    if (vs.mode === 'interior') {
      hint.textContent = '↑/↓ floor · ←/→ select · ENTER buy/beg · E roof';
      panel.style.display = 'block';
      const where = vs.currentResidentName ? vs.currentResidentName : `Floor ${vs.floor} — empty`;
      panelTitle.textContent = `Floor ${vs.floor} · ${where}`;
      renderOptions(vs);
    } else {
      hint.textContent = 'E enter building · ←/→ aim · SPACE/tap fire';
      panel.style.display = 'none';
    }

    updateFeedback(vs);
  }

  // Show the result dialog only while inside, and (re)play its pop animation each time a NEW result lands
  // (tracked by `nonce`, so two identical buys still animate). When there's nothing to show, hide it.
  function updateFeedback(vs: PlayingViewState): void {
    const fb = vs.feedback;
    if (vs.mode !== 'interior' || !fb) {
      fbCard.style.display = 'none';
      lastFeedbackNonce = fb ? fb.nonce : -1;
      return;
    }
    if (fb.nonce === lastFeedbackNonce) return; // already showing this result — let it finish its animation
    lastFeedbackNonce = fb.nonce;

    const accent = fb.ok ? (fb.kind === 'favor' ? T.accent : T.good) : T.danger;
    fbCard.style.borderColor = accent;
    fbTitle.style.color = accent;
    fbTitle.textContent = `${fb.ok ? (fb.kind === 'favor' ? '🤲 ' : '✅ ') : '🚫 '}${fb.title}`;
    fbWho.textContent = fb.who;
    fbWho.style.display = fb.who ? 'block' : 'none';

    fbLines.replaceChildren();
    fb.lines.forEach((line, i) => {
      const row = el(
        'div',
        { fontSize: '2vh', color: TONE_COLOR[line.tone], display: 'flex', gap: '0.8vh', alignItems: 'baseline', animation: `ggo-rowin 0.18s ease-out both`, animationDelay: `${0.08 + i * 0.05}s` },
      );
      row.appendChild(el('span', { width: '2.6vh', textAlign: 'center', flex: '0 0 auto' }, line.icon));
      row.appendChild(el('span', {}, line.text));
      fbLines.appendChild(row);
    });

    fbCard.style.display = 'block';
    fbCard.style.animation = 'none';
    void fbCard.offsetWidth; // reflow so the entrance restarts even on a back-to-back result
    fbCard.style.animation = 'ggo-pop 1.9s ease-out forwards';
  }

  function renderOptions(vs: PlayingViewState): void {
    panelList.replaceChildren();
    if (vs.options.length === 0) {
      panelList.appendChild(el('div', { opacity: '0.8', fontSize: '2vh' }, vs.currentResidentId ? 'Nothing on offer right now.' : 'Knock, knock… nobody home.'));
      return;
    }
    vs.options.forEach((o, i) => {
      const selected = i === vs.selected;
      const disabled = o.option.disabledReason !== undefined;
      const price = o.option.costRubles !== undefined ? ` ₽${o.option.costRubles}` : '';
      const tail = disabled ? ` (${o.option.disabledReason})` : o.option.consequencePreview ? ` [${o.option.consequencePreview}]` : '';
      const label = `${o.kind === 'favor' ? 'BEG ' : ''}${o.option.label}${price}${tail}`;
      const row = el('div', {
        fontSize: '2.1vh',
        padding: '0.5vh 1vh',
        borderRadius: '3px',
        background: selected ? T.surface : 'transparent',
        color: disabled ? T.textMuted : o.kind === 'favor' ? T.accent : T.text,
        outline: selected ? `2px solid ${T.surfaceRaised}` : 'none',
      }, `${selected ? '▶ ' : '  '}${label}`);
      panelList.appendChild(row);
    });
  }

  return {
    update,
    setVisible(visible: boolean): void {
      root.style.display = visible ? 'block' : 'none';
      // Start each run by adopting the opening balance silently (no spend flash on the 0-ruble reset).
      if (visible) justShown = true;
    },
    dispose(): void {
      root.remove();
    },
  };
}
