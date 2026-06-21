# Area: Audio (Music & Sound Effects)

**Owner:** <unassigned> · **Depends on:** Core Platform & Build, State & Persistence (Settings) · **Depended on by:** Gameplay Engine, Scoring, Random Incidents, Meters, Main Menu, HUD (all emit events this area reacts to)

## 1. Purpose

This area owns everything the player hears: a looping, upbeat chiptune music bed
whose intensity tracks the difficulty `D` and active incidents, and a bank of sound
effects driven by the typed event bus. All audio goes through the Web Audio API
behind an **injectable backend** so the rest of the game can fire-and-forget audio
events while staying fully testable (no real `AudioContext` is ever constructed in
tests). The cheerful, bouncy soundtrack is a core part of the game's tonal contrast
(bright surface, grim subtext) — keep it relentlessly upbeat.

## 2. Scope

### In scope
- The `AudioBackend` interface (wrapping `AudioContext`) and its real implementation.
- Audio context unlock on first user gesture.
- The **music director**: looping playback, layered intensity, ducking.
- The **SFX bank**: loading + triggering sound effects from event-bus subscriptions.
- A per-channel gain graph (master / music / sfx) + mute, driven by Settings.
- Audio asset loading/decoding/caching, plus a synthesized placeholder-tone fallback.

### Out of scope (owned elsewhere)
- The settings UI and persistence of volume values → **State & Persistence / Settings**.
- Deciding *when* gameplay events fire → the emitting areas (Gameplay Engine, Scoring, etc.).
- The visual telegraph of incidents → **Random Incidents / HUD** (we only react to `incidentStart`/`incidentEnd`).
- Actual music composition / final asset production → **Art & Audio asset production** (we define formats, slots, and a fallback so we are never blocked).

## 3. Requirements & mechanics

1. **Injectable backend.** All Web Audio access goes through an `AudioBackend`
   interface. Production uses `WebAudioBackend` (real `AudioContext`); tests use
   `FakeAudioBackend`. No module under `src/audio/` may reference the global
   `AudioContext`/`webkitAudioContext` except inside `WebAudioBackend`.
2. **Context unlock.** Browsers start the `AudioContext` suspended until a user
   gesture. The audio engine exposes `unlock()` which `resume()`s the context; Core
   input calls it on the first pointer/key/touch event. Before unlock, calls are
   queued or no-op safely (never throw). After unlock, playback proceeds normally.
3. **Gain graph.** Three gain nodes: `master → destination`, with `music` and `sfx`
   sub-gains feeding `master`. Every source connects through its channel gain.
   Effective volume = `master * channel`, with mute forcing the relevant gain to 0
   (values restored on unmute). All three levels and mute come from Settings.
4. **Music director.**
   - Plays a looping, upbeat chiptune bed continuously during the `Playing` scene;
     a calmer loop in menus.
   - **Layered intensity:** the bed is composed of stacked layers (e.g. `base`,
     `drums`, `lead`, `frenzy`). As difficulty `D` crosses configured thresholds,
     layers fade in/out (crossfade, no hard cuts) to raise intensity. Implementation
     may be additive stems *or* whole-track swaps behind the same `setIntensity(level)`
     API — the area chooses, but the API is intensity-level driven.
   - **Incident response:** on `incidentStart` for a "major" incident (e.g. major
     drone attack), push intensity up and/or layer in an alarm motif; restore on
     `incidentEnd`.
   - **Ducking:** during dialog/telegraphs (favor/service dialogs, incident
     announcements) duck music gain by a configured amount, then restore. Exposed as
     `duck(amount, ms)` / `unduck(ms)`; UI/Incidents request ducking via events or a
     direct call routed through the engine.
   - Subscribes to: difficulty changes (read `GameState.time.difficulty` each
     update tick, debounced to threshold crossings), `incidentStart`, `incidentEnd`,
     and scene-change notifications from the SceneManager.
5. **SFX bank.** Subscribes to the event bus and plays the mapped one-shot for each
   event (table in §4). Multiple simultaneous plays are allowed (pooled/overlapping
   sources). Rapid identical events (e.g. machine-gun fire) are rate-limited /
   voice-capped to avoid clipping; gunfire may use a short looped "firing" sample
   gated by `shotFired` cadence.
6. **Live settings response.** When Settings change (volume sliders, mute toggled),
   gains update immediately without restarting playback. The engine subscribes to a
   settings-changed signal (event or callback from Persistence).
7. **Placeholder fallback.** Until real assets exist, any missing asset resolves to
   a synthesized tone (oscillator/noise burst with a short envelope) so dependent
   areas hear *something* and tests have deterministic behavior. A flag
   (`usePlaceholders`) forces this mode.
8. **Never block or crash gameplay.** Audio failures (decode error, suspended
   context, missing asset) degrade gracefully and are logged once, never thrown into
   the game loop.

## 4. Public interface (TypeScript)

```ts
// src/audio/backend.ts ─ the injection seam (tests provide a fake)
export interface AudioBackend {
  readonly state: 'suspended' | 'running' | 'closed';
  readonly currentTime: number;
  resume(): Promise<void>;                      // unlock
  createGain(): GainHandle;
  decode(bytes: ArrayBuffer): Promise<AudioBuffer | DecodedHandle>;
  playBuffer(buffer: DecodedHandle, opts: PlayOpts): VoiceHandle;  // one-shot or loop
  playTone(opts: ToneOpts): VoiceHandle;        // placeholder/synth fallback
  readonly destination: GainHandle;
}
export interface GainHandle { gain: number; connect(to: GainHandle): void; }
export interface VoiceHandle { stop(): void; readonly active: boolean; }
export interface PlayOpts { channel: 'music' | 'sfx'; loop?: boolean; gain?: number; rate?: number; }
export interface ToneOpts { channel: 'music' | 'sfx'; freq: number; durationMs: number; type?: OscillatorType; gain?: number; }

// src/audio/engine.ts ─ the façade the rest of the game uses
export interface AudioEngine {
  init(backend: AudioBackend, settings: AudioSettings): void;
  unlock(): Promise<void>;                      // call from Core on first gesture
  bind(events: EventBus): void;                 // wire SFX + music to the event bus
  setIntensity(level: number): void;            // 0..N music intensity tiers
  duck(amount: number, ms: number): void;
  unduck(ms: number): void;
  applySettings(s: AudioSettings): void;        // live volume/mute update
  playSfx(id: SfxId): VoiceHandle | null;       // manual trigger (UI clicks, etc.)
  update(state: GameState, dt: number): void;   // reads difficulty → intensity
  dispose(): void;
}
export interface AudioSettings { master: number; music: number; sfx: number; muted: boolean; }
export type SfxId =
  | 'gunFire' | 'droneExplode' | 'kaching' | 'rubleTick' | 'meterWarn'
  | 'jackpot' | 'comboUp' | 'incidentAlarm' | 'gameOver' | 'uiSelect' | 'uiConfirm';
```

### Event → SFX map

| Event (from bus) | SFX | Notes |
|---|---|---|
| `shotFired` | `gunFire` | rate-limited / voice-capped; may be a gated loop |
| `droneDestroyed` (`byPlayer`) | `droneExplode` + `kaching` | explosion + cash-register; `kaching` only when a ruble is actually banked |
| `droneEscaped` | `meterWarn` (low thud variant) | drone hit the building |
| `rublesChanged` | `rubleTick` | subtle; suppressed if `kaching` just played same frame |
| `meterCrisis` (`entered:true`) | `meterWarn` | per-meter pitch variation optional |
| `scoreChanged` (large / jackpot reason) | `jackpot` | threshold or `reason==='jackpot'/'bonusMode'` |
| `comboChanged` (multiplier up) | `comboUp` | ascending pitch with multiplier |
| `incidentStart` | `incidentAlarm` | + music intensity push / alarm layer |
| `incidentEnd` | — | restore music intensity |
| `gameOver` | `gameOver` | stop music (fade), play stinger |

## 5. Data / content tables

`src/content/audio.ts`:
- **SFX manifest:** `SfxId → { src: string; gain: number; maxVoices: number; rateLimitMs?: number; fallbackTone: ToneOpts }`.
- **Music manifest:** ordered layer list per scene `{ scene, layers: [{ id, src, fallbackTone }], intensityThresholds: number[] }` mapping difficulty/incident state → active layer set.
- **Ducking presets:** `{ dialog: { amount, ms }, incident: { amount, ms } }`.

## 6. Persistence

**None written by this area.** Volume/mute live in the Settings blob owned by
**State & Persistence**; this area only *reads* them via `AudioSettings` and reacts
to change notifications.

## 7. Dependencies & integration

- **Consumes events:** `shotFired`, `droneDestroyed`, `droneEscaped`,
  `rublesChanged`, `meterCrisis`, `scoreChanged`, `comboChanged`, `incidentStart`,
  `incidentEnd`, `gameOver`.
- **Reads state:** `GameState.time.difficulty` (for music intensity) each `update`.
- **Injected:** `AudioBackend` (from Core/main bootstrap), `EventBus` (core/events),
  `AudioSettings` (from Persistence/Settings).
- **Coordinates with Core input** for the unlock gesture, and with **SceneManager**
  for scene-based music switching and ducking on dialog open/close.

## 8. Required automated tests (MUST pass)

All tests use `FakeAudioBackend`; per architecture.md §7 the suite must be green
(`npm run check`) and must construct **no** real `AudioContext`.

1. **Event→SFX mapping:** emitting each bus event plays exactly the mapped SFX id(s)
   on the fake backend (assert via recorded `playBuffer`/`playTone` calls); e.g.
   `droneDestroyed{byPlayer:true}` triggers both `droneExplode` and `kaching`.
2. **No real AudioContext:** a guard test asserts the global `AudioContext` /
   `webkitAudioContext` constructor is never invoked across the audio suite.
3. **Per-channel gain application:** setting master/music/sfx levels sets the
   corresponding gain-node values; effective gain = `master * channel`.
4. **Mute:** muting forces master (or per-channel) gain to 0 and silences subsequent
   plays; unmuting restores prior levels.
5. **Live settings update:** `applySettings` mid-playback changes gains without
   stopping active voices.
6. **Music intensity by difficulty:** advancing `update(state, dt)` past configured
   `D` thresholds calls `setIntensity` / changes the active layer set; crossing back
   down restores the lower set.
7. **Incident intensity:** `incidentStart` raises intensity / adds alarm layer;
   `incidentEnd` restores it.
8. **Ducking:** `duck` lowers music gain by the configured amount and `unduck`
   restores it over the given time.
9. **Unlock:** before `unlock()` the context is `suspended` and plays are queued /
   no-op without throwing; after `unlock()` (`resume`) queued/new plays proceed.
10. **Rate-limit / voice-cap:** a burst of `shotFired` events does not exceed
    `maxVoices` simultaneous `gunFire` voices.
11. **Placeholder fallback:** with `usePlaceholders` (or a missing asset), `playTone`
    is used instead of `playBuffer` and the call still succeeds.

## 9. Acceptance criteria / Definition of done

- [ ] `AudioEngine` + `AudioBackend` (`WebAudioBackend`, `FakeAudioBackend`) implemented per §4.
- [ ] All event→SFX mappings in §4 wired through `bind(events)`.
- [ ] Layered music intensity responds to `D` and incidents; ducking works.
- [ ] Volume/mute read from Settings and update live.
- [ ] Placeholder-tone fallback lets dependent areas integrate before real assets ship.
- [ ] Audio never throws into the game loop; failures degrade gracefully.
- [ ] All §8 tests authored and passing; `npm run check` green (global DoD, architecture.md §9).

## 10. Open questions / risks

- **Layered stems vs. track swaps** for intensity — decide based on asset budget;
  API stays intensity-level driven either way.
- Mobile autoplay/`resume()` quirks (iOS Safari) — verify unlock gesture coverage.
- Decode cost of many SFX at boot — consider lazy decode + caching; measure.
- Avoiding gunfire SFX "machine-gun clipping" — tune `maxVoices`/rate-limit or use a
  gated loop sample; needs a real-asset pass.
- Final source format (`.ogg` vs `.mp3` vs tracker) pending the asset-production area.
