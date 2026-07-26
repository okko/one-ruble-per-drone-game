/**
 * Pure list-navigation model shared by every menu in the game
 * (docs/areas/10-hud-ui.md §3.1c/§4).
 *
 * Keyboard, pointer, and touch all drive *this*, so they cannot diverge. It is
 * deliberately free of the DOM: wrap-around and disabled-skipping are the two
 * places menu code traditionally goes wrong, and they are much easier to get
 * right — and to prove right — as arithmetic than as event handlers.
 */

export interface MenuModel {
  /** Number of entries in the list. */
  readonly count: number;
  /** Currently selected index. May be out of range; `clampSelection` repairs it. */
  readonly index: number;
  /** Whether the entry at `i` can be selected. */
  readonly isEnabled: (i: number) => boolean;
}

/** True modulo — unlike `%`, the result is never negative. */
function wrap(i: number, count: number): number {
  return ((i % count) + count) % count;
}

/**
 * Moves the selection by `delta`, wrapping around the ends and skipping
 * disabled entries.
 *
 * Returns the current index unchanged when the list is empty or when every
 * entry is disabled — a menu of dead options must not hang, and it must not
 * pretend something got selected.
 */
export function moveSelection(m: MenuModel, delta: number): number {
  if (m.count <= 0) return m.index;

  const step = delta === 0 ? 0 : delta > 0 ? 1 : -1;
  if (step === 0) return clampSelection(m);

  const from = wrap(m.index, m.count);
  // At most `count` probes: enough to visit every entry exactly once and stop.
  for (let n = 1; n <= m.count; n++) {
    const candidate = wrap(from + step * n, m.count);
    if (m.isEnabled(candidate)) return candidate;
  }
  return m.index;
}

/**
 * Repairs an index that is out of range, or that points at an entry which has
 * since been disabled — e.g. an option that became unaffordable while the panel
 * was open. Searches forward first so the selection drifts down the list rather
 * than jumping backwards under the player's hands.
 */
export function clampSelection(m: MenuModel): number {
  if (m.count <= 0) return 0;

  const start = wrap(m.index, m.count);
  if (m.isEnabled(start)) return start;

  for (let n = 1; n <= m.count; n++) {
    const forward = wrap(start + n, m.count);
    if (m.isEnabled(forward)) return forward;
  }
  return start;
}
