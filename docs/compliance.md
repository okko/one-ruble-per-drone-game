# Content Compliance & Respect Requirements

> Status: **Foundation doc (mandatory).** Every engineer and content author MUST read
> and obey this. It governs all player-facing text, names, art, audio, character
> design, and data tables. Read alongside `game-design.md` and `architecture.md`.

## 1. Why this exists
The game is satire set against Russia's "special military operation." Satire is the
point — but it must be aimed correctly: punch at power, never down at people.

## 2. The core rule
- **Fair game (mock freely):** the Russian empire/state, its dictators, politicians,
  the regime's ideology and propaganda, the war itself, and the military as an
  institution (conscription, corruption, exploitation).
- **Off limits (respect, never ridicule):** ordinary Russian people and civilians —
  including the conscripted soldier protagonist and the building's residents. No
  ethnic or national stereotypes (drunkenness, poverty, dirtiness, stupidity,
  backwardness) used as a trait of Russians or Russian-ness.
- Everyone is treated equally and with dignity. Characters are individuals defined by
  personality and circumstance, not by ethnic caricature.

## 3. Rules for content authors
1. **Punch up, not down.** Jokes target power (regime, oligarchy, war machine), not
   the powerless (conscripts, civilians, the poor).
2. **The soldier is a sympathetic, exploited human, not a buffoon.** His suffering
   indicts the system, not him.
3. **Residents are people with agency and dignity.** Cultural specificity (names,
   food, faith) is welcome and respectful; caricature is not.
4. **Vices are coping needs, not national traits.** Vodka and cigarettes are
   mechanical human needs in a grim situation — never framed as an inherent Russian
   trait or a person's defining identity. "Drunk" is a neutral gameplay debuff term.
5. **Hardship reflects exploitation, not ethnicity.** Poverty, sanitation, and hunger
   beats depict the soldier's exploitation by the system; never play civilian poverty
   or dirtiness for ethnic comedy.
6. **Regime language is satire of the state's voice** ("Comrade", propaganda copy),
   not of citizens.
7. **No slurs or dehumanizing language**, and no real private individuals depicted
   defamatorily (legitimate political satire of public figures excepted).
8. **When in doubt, ask:** does this mock power, or a people? If the latter, rewrite.

## 4. Where this applies
All areas — especially Economy & Residents (roster, services, favors, dialog), Random
Incidents (names/flavor), Highscores (seed names + flavor lines), HUD/UI (toasts/
dialog), Main Menu (taglines), Art (resident/civilian depiction), Audio (any VO/lyrics).

## 5. Process (Definition-of-Done addition)
- Every area's DoD now includes: **"All player-facing copy, names, art, and audio
  reviewed against `docs/compliance.md`."**
- New or changed player-facing content gets a compliance check before merge.
- Content tables (residents, incidents, highscore seeds) are reviewed as data, not
  just as code.

## 6. Current watch-items (reviewed & retained by owner decision — keep within bounds)
These were reviewed and **kept**; authors must keep their framing pointed at the
system/situation, never at Russian people:
- The vice meter and vodka/cigarette satisfiers, incl. the veteran "Old Dmitri" vodka
  service and the "drunk" debuff (`02-meters-and-status`, `03-economy-and-residents`,
  `game-design §5`). **Reframed (good example):** Dmitri's drinking and bitterness
  stem from how the army used and discarded him — coping and bitter solidarity with
  the conscript, with the satire aimed at the military institution. Keep vodka a
  coping need — never a character's identity, an ethnic trait, or a national joke.
- Degraded-favor flavor — plumber "bucket in the hall", chef "burnt scraps", babushka
  "three days old" leftovers (`03-economy-and-residents §5`). Keep the humor about the
  soldier's exploited desperation, not civilian poverty/dirtiness.
- "COMRADE!"-style copy and grim-funny highscore seed names (`08-highscores`) —
  allowed as regime-voice satire; seed names must not be ethnic caricatures.

## 7. Quick test
Before shipping any line or asset: *"Does this mock the empire/regime/war/military-
institution, or does it mock ordinary Russian people?"* Ship the former. Rewrite the
latter.
