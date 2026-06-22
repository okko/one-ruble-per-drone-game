/**
 * Incident visual overlays (docs/areas/11-art-visual-style.md §3.6). PURE `Renderer`-only, driven by
 * the read-only `gs.incidents.flags` — no new sim state. Blackout darkens the scene with a dithered
 * `ink` scanline pattern (capped so muzzle flash + drone accents still read through, per §3.6, and
 * needing no translucent-fill primitive); a pipe failure shows a dripping motif. HUD flicker and the
 * propaganda letterbox are deferred (they need portrait art + incident-id coupling).
 */
import type { Renderer } from './renderer';
import type { GameState } from '../state/game-state';

export function drawIncidentOverlays(r: Renderer, gs: GameState): void {
  const f = gs.incidents.flags;

  // Blackout: fill `darkRows` of every 4 scanlines with ink — 0 (off) … 3 (≈75% dark, max).
  if (f.blackout > 0) {
    const darkRows = Math.min(3, Math.round(f.blackout * 4));
    for (let y = 0; y < r.height && darkRows > 0; y++) {
      if (y % 4 < darkRows) r.fillRect(0, y, r.width, 1, 'ink');
    }
  }

  // Pipe failure: a blue drip near the bottom-left toilet/intercom region (code-driven cycle).
  if (f.toiletBlocked) {
    const dy = (Math.floor(gs.time.shiftSeconds * 4) % 3) * 3;
    r.drawSprite('fx.drip', { x: 14, y: 128 + dy });
  }
}
