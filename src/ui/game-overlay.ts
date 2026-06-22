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
import { PALETTE } from '../render/palette';
import { METER_DISPLAY_ORDER } from './hud/theme';
import type { Content } from '../content/loader';
import type { GameState } from '../state/game-state';
import type { PlayingViewState } from '../state/playing-view';
import type { MeterKey } from '../types/meter-key';

export interface GameOverlay {
  update(gs: GameState, vs: PlayingViewState): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

const METER_EMOJI: Record<MeterKey, string> = { sleep: '😴', hunger: '🍞', thirst: '💧', vice: '🚬', poo: '💩' };

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
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    color: PALETTE.cream,
    textShadow: '0 2px 4px rgba(0,0,0,0.8)',
    zIndex: '5',
    userSelect: 'none',
  });

  // ---- Meters (top-left) --------------------------------------------------------------------
  const metersBox = el('div', { position: 'absolute', top: '2vh', left: '2vh', display: 'grid', gap: '0.6vh' });
  const meterBars = new Map<MeterKey, HTMLElement>();
  for (const key of METER_DISPLAY_ORDER) {
    const row = el('div', { display: 'flex', alignItems: 'center', gap: '0.8vh' });
    row.appendChild(el('span', { fontSize: '2.4vh', width: '3vh' }, METER_EMOJI[key]));
    const track = el('div', { width: '18vh', height: '1.6vh', background: 'rgba(0,0,0,0.45)', border: `1px solid ${PALETTE.shadow}`, borderRadius: '2px', overflow: 'hidden' });
    const fill = el('div', { height: '100%', width: '0%', background: PALETTE.meterGood, transition: 'width 0.1s linear' });
    track.appendChild(fill);
    row.appendChild(track);
    metersBox.appendChild(row);
    meterBars.set(key, fill);
  }
  root.appendChild(metersBox);

  // ---- Score + combo (top-right) ------------------------------------------------------------
  const scoreBox = el('div', { position: 'absolute', top: '2vh', right: '2vh', textAlign: 'right' });
  const scoreText = el('div', { fontSize: '3.4vh', fontWeight: '700', color: PALETTE.domeGold }, '00,000,000');
  const comboText = el('div', { fontSize: '2.2vh', color: PALETTE.cream }, '×1');
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
  const rublesText = el('div', { position: 'absolute', bottom: '5vh', left: '2vh', fontSize: '3vh', color: PALETTE.domeGold }, '₽ 0');
  const debtText = el('div', { position: 'absolute', bottom: '2vh', left: '2vh', fontSize: '2.2vh', color: PALETTE.meterCrit }, '');
  root.appendChild(rublesText);
  root.appendChild(debtText);

  // ---- City integrity (bottom-centre) -------------------------------------------------------
  const integBox = el('div', { position: 'absolute', bottom: '2vh', left: '50%', transform: 'translateX(-50%)', textAlign: 'center', width: '36vh' });
  integBox.appendChild(el('div', { fontSize: '1.8vh', letterSpacing: '0.2vh' }, 'CITY INTEGRITY'));
  const integTrack = el('div', { width: '100%', height: '2vh', background: 'rgba(0,0,0,0.5)', border: `1px solid ${PALETTE.shadow}`, borderRadius: '3px', overflow: 'hidden', marginTop: '0.4vh' });
  const integFill = el('div', { height: '100%', width: '100%', background: PALETTE.meterGood, transition: 'width 0.2s linear' });
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
    border: `2px solid ${PALETTE.panelLite}`,
    borderRadius: '6px',
    padding: '2vh',
    display: 'none',
  });
  const panelTitle = el('div', { fontSize: '2.8vh', fontWeight: '700', color: PALETTE.domeGold, marginBottom: '1vh' }, '');
  const panelList = el('div', { display: 'grid', gap: '0.6vh' });
  panel.appendChild(panelTitle);
  panel.appendChild(panelList);
  root.appendChild(panel);

  host.appendChild(root);

  function update(gs: GameState, vs: PlayingViewState): void {
    // Meters.
    for (const key of METER_DISPLAY_ORDER) {
      const fill = meterBars.get(key);
      if (!fill) continue;
      const v = Math.max(0, Math.min(100, gs.meters.values[key]));
      fill.style.width = `${v}%`;
      fill.style.background = gs.meters.inCrisis[key] ? PALETTE.meterCrit : v >= warn[key] ? PALETTE.meterWarn : PALETTE.meterGood;
    }

    // Score + combo.
    scoreText.textContent = fmtScore(gs.scoring.score);
    comboText.textContent = `×${gs.scoring.multiplier}`;

    // Rubles + debt.
    rublesText.textContent = `₽ ${gs.economy.rubles}`;
    debtText.textContent = gs.economy.debt > 0 ? `DEBT ₽-${gs.economy.debt}` : '';

    // City integrity.
    const frac = Math.max(0, Math.min(1, gs.combat.postIntegrity / maxIntegrity));
    integFill.style.width = `${frac * 100}%`;
    integFill.style.background = frac > 0.5 ? PALETTE.meterGood : frac > 0.25 ? PALETTE.meterWarn : PALETTE.meterCrit;

    // Wave / siren banner.
    const phase = gs.combat.waves.phase;
    if (vs.siren.active) {
      const secs = Math.max(0, Math.ceil(vs.siren.secondsUntilWave ?? 0));
      banner.textContent = `🚨 AIR RAID — INCOMING ${secs}s`;
      banner.style.background = PALETTE.meterCrit;
      banner.style.color = PALETTE.cream;
      banner.style.opacity = Math.sin(gs.time.shiftSeconds * 8) > 0 ? '1' : '0.55';
    } else if (phase === 'active') {
      banner.textContent = `WAVE ${gs.combat.waves.index}`;
      banner.style.background = 'rgba(0,0,0,0.4)';
      banner.style.color = PALETTE.cream;
      banner.style.opacity = '1';
    } else {
      const secs = Math.max(0, Math.ceil(vs.siren.secondsUntilWave ?? 0));
      banner.textContent = `NEXT WAVE IN ${secs}s — visit residents`;
      banner.style.background = 'rgba(0,0,0,0.35)';
      banner.style.color = PALETTE.meterGood;
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
        background: selected ? PALETTE.panel : 'transparent',
        color: disabled ? PALETTE.concrete : o.kind === 'favor' ? PALETTE.domeGold : PALETTE.cream,
        outline: selected ? `2px solid ${PALETTE.panelLite}` : 'none',
      }, `${selected ? '▶ ' : '  '}${label}`);
      panelList.appendChild(row);
    });
  }

  return {
    update,
    setVisible(visible: boolean): void {
      root.style.display = visible ? 'block' : 'none';
    },
    dispose(): void {
      root.remove();
    },
  };
}
