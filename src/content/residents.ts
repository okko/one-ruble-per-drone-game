/**
 * Resident roster + economy tunables (docs/areas/03-economy-and-residents.md §5). DATA, not logic.
 *
 * COMPLIANCE (docs/compliance.md — this is the highest-risk content area): satire targets the
 * regime / war / military-as-institution, NEVER ordinary Russian people. Residents are individuals
 * with dignity. Vodka/cigarettes are coping NEEDS in a grim situation, never an ethnic trait. Old
 * Dmitri's drinking and bitterness stem from how the army used and discarded him — keep his satire
 * pointed at the military institution. Copy stays cheerful-on-the-surface, grim-underneath.
 * Validated by `validateResidents` / `validateEconomyTunables` and scanned by the content-lint.
 */
import type { MeterKey } from '../types/meter-key';

/** Points to subtract from `meter` (relieve). `secondary` is a signed value delta: positive worsens
 * a second meter (e.g. degraded food spikes 💩), negative relieves it (e.g. tea also soothes sleep).
 * `effect` is a neutral marker for a timed meter side effect the relief-bridge maps to the Meters
 * area (vodka → drunk, energy/coffee → coffee timer) — keeps content decoupled from ReliefKind. */
export interface ReliefRequest {
  meter: MeterKey;
  amount: number;
  secondary?: { meter: MeterKey; amount: number };
  effect?: 'drunk' | 'coffee';
}

export interface ServiceDef {
  id: string;
  label: string; // cheerful flavor
  basePrice: number; // rubles, >= 1
  tags: string[]; // e.g. ['delivery'], ['toilet'], ['nap'], ['gun']
  relief?: ReliefRequest; // a 'gun'-tagged jam-clear has no meter relief (Engine enacts it)
}

export type ConsequenceKind = 'debt' | 'chore' | 'reputation' | 'degraded';

export type Consequence =
  | { kind: 'debt'; amount: number }
  | { kind: 'chore'; durationSeconds: number }
  | { kind: 'reputation'; amount: number }
  | { kind: 'degraded'; reliefScale: number; sideEffect?: { meter: MeterKey; amount: number } };

export interface FavorDef {
  id: string;
  label: string;
  minRelationship: number; // gate
  relief?: ReliefRequest; // base (pre-quality-factor) effect; absent for non-meter favors
  consequence: Consequence;
}

export interface ResidentDef {
  id: string;
  name: string;
  floor: number;
  personality: string; // flavor — keep satire on the system, never on a people
  services: ServiceDef[];
  favors: FavorDef[];
}

export const RESIDENTS: ResidentDef[] = [
  {
    id: 'babushka',
    name: 'Galina Petrovna',
    floor: 3,
    personality: 'Warm and terrifying in equal measure; feeds you like her own and will not hear no.',
    services: [
      { id: 'stew', label: "Babushka's Famous Stew", basePrice: 4, tags: [], relief: { meter: 'hunger', amount: 45 } },
      {
        id: 'tea',
        label: 'Strong Tea, Three Sugars',
        basePrice: 2,
        tags: [],
        relief: { meter: 'thirst', amount: 20, secondary: { meter: 'sleep', amount: -10 } },
      },
    ],
    favors: [
      {
        id: 'leftovers',
        label: 'Last Night’s Leftovers',
        minRelationship: 30,
        relief: { meter: 'hunger', amount: 45 },
        consequence: { kind: 'degraded', reliefScale: 0.6, sideEffect: { meter: 'poo', amount: 12 } },
      },
    ],
  },
  {
    id: 'plumber',
    name: 'Sergei the Plumber',
    floor: 7,
    personality: 'A gloomy realist who has seen every pipe in the building fail at least twice.',
    services: [
      { id: 'toilet', label: 'Use the Good Bathroom', basePrice: 3, tags: ['toilet'], relief: { meter: 'poo', amount: 60 } },
      { id: 'pipewisdom', label: 'A Word of Pipe Wisdom', basePrice: 1, tags: [], relief: { meter: 'sleep', amount: 8 } },
    ],
    favors: [
      {
        id: 'bucket',
        label: 'The Bucket in the Hall',
        minRelationship: 20,
        relief: { meter: 'poo', amount: 40 },
        consequence: { kind: 'reputation', amount: 10 },
      },
    ],
  },
  {
    id: 'oligarch',
    name: 'Mr. Volkov',
    floor: 22,
    personality: 'Penthouse smile, generous for the audience; every kindness is an investment.',
    services: [
      { id: 'water', label: 'Imported Mineral Water', basePrice: 5, tags: [], relief: { meter: 'thirst', amount: 50 } },
      { id: 'cigar', label: 'A Genuine Cuban Cigar', basePrice: 6, tags: [], relief: { meter: 'vice', amount: 60 } },
      { id: 'nap', label: 'The Nap Suite', basePrice: 8, tags: ['nap'], relief: { meter: 'sleep', amount: 70 } },
    ],
    favors: [
      {
        id: 'loan',
        label: 'A Generous Little Loan',
        minRelationship: 0,
        relief: { meter: 'sleep', amount: 40 },
        consequence: { kind: 'debt', amount: 10 },
      },
    ],
  },
  {
    id: 'veteran',
    name: 'Old Dmitri',
    floor: 5,
    // Compliance watch-item: the army used him up and threw him away. Vodka is how he copes; his
    // pep talks are bitter solidarity with a fellow conscript. The target is the institution.
    personality: 'Grizzled and gentle with you, bitter at the army that spent his years and gave back a bad knee.',
    services: [
      {
        id: 'vodka',
        label: 'A Shot to Take the Edge Off',
        basePrice: 3,
        tags: [],
        relief: { meter: 'vice', amount: 70, secondary: { meter: 'sleep', amount: -15 }, effect: 'drunk' },
      },
      { id: 'peptalk', label: 'A Few Hard-Won Words', basePrice: 1, tags: [], relief: { meter: 'sleep', amount: 12 } },
    ],
    favors: [
      {
        id: 'flask',
        label: 'A Pull from the Shared Flask',
        minRelationship: 20,
        relief: { meter: 'vice', amount: 50 },
        // Mostly water — his pension won't stretch to more; barely helps, and won't let you rest.
        consequence: { kind: 'degraded', reliefScale: 0.7, sideEffect: { meter: 'sleep', amount: 6 } },
      },
    ],
  },
  {
    id: 'chef',
    name: 'Anya from the Café Below',
    floor: 1,
    personality: 'Bubbly and quick; runs the little café and sends food up when the lift cooperates.',
    services: [
      { id: 'pelmeni', label: 'A Bowl of Hot Pelmeni', basePrice: 5, tags: ['delivery'], relief: { meter: 'hunger', amount: 55 } },
      { id: 'kvass', label: 'A Cold Glass of Kvass', basePrice: 3, tags: ['delivery'], relief: { meter: 'thirst', amount: 35 } },
    ],
    favors: [
      {
        id: 'scraps',
        label: 'Whatever’s Left at Closing',
        minRelationship: 25,
        relief: { meter: 'hunger', amount: 25 },
        consequence: { kind: 'chore', durationSeconds: 12 },
      },
    ],
  },
  {
    id: 'mechanic',
    name: 'Iron Lyuba',
    floor: 9,
    personality: 'Brusque and unbeatable with a wrench; fixes what the building breaks, for a price.',
    services: [
      { id: 'clearjam', label: 'Clear That Jam, Soldier', basePrice: 4, tags: ['gun'] }, // no meter relief; Engine clears the jam
      { id: 'sparesmoke', label: 'A Spare Cigarette', basePrice: 2, tags: [], relief: { meter: 'vice', amount: 40 } },
    ],
    favors: [
      {
        id: 'jamiou',
        label: 'Clear It Now, Owe Me Later',
        minRelationship: 15,
        consequence: { kind: 'debt', amount: 6 }, // jam-clear on credit; Engine enacts the fix
      },
    ],
  },
  {
    id: 'student',
    name: 'Kostya Upstairs',
    floor: 14,
    personality: 'An anxious insomniac who never sleeps and always has something fizzy or smokable.',
    services: [
      {
        id: 'energydrink',
        label: 'A Suspicious Energy Drink',
        basePrice: 3,
        tags: [],
        relief: { meter: 'sleep', amount: 30, secondary: { meter: 'vice', amount: 5 }, effect: 'coffee' },
      },
      { id: 'cigarette', label: 'A Borrowed Cigarette', basePrice: 2, tags: [], relief: { meter: 'vice', amount: 40 } },
    ],
    favors: [
      {
        id: 'bummedsmoke',
        label: 'Bum One Off Kostya',
        minRelationship: 15,
        relief: { meter: 'vice', amount: 25 },
        consequence: { kind: 'reputation', amount: 6 },
      },
    ],
  },
  {
    id: 'priest',
    name: 'Father Pavel',
    floor: 11,
    personality: 'Serene to the point of ominous; offers counsel, water, and a quiet place to breathe.',
    services: [
      { id: 'confession', label: 'A Quiet Confession', basePrice: 2, tags: [], relief: { meter: 'sleep', amount: 15 } },
      { id: 'blessedwater', label: 'A Cup of Blessed Water', basePrice: 3, tags: [], relief: { meter: 'thirst', amount: 45 } },
    ],
    favors: [
      {
        id: 'charity',
        label: 'A Charitable Meal',
        minRelationship: 10,
        relief: { meter: 'hunger', amount: 40 },
        consequence: { kind: 'reputation', amount: 4 },
      },
    ],
  },
];

/** Economy balance constants (reputation model, pricing, gating) — §3.8/§3.9. */
export interface EconomyTunables {
  startingRelationship: number; // per-resident relationship at run start
  relationshipBaseline: number; // drift target (§3.8)
  reputationBaseline: number;
  buyRelationshipGain: number; // +relationship on a purchase
  buyReputationGain: number; // +global reputation on a purchase
  relationshipDriftPerSec: number; // drift toward baseline
  reputationDriftPerSec: number;
  refusalFloor: number; // below this relationship, all favors refused
  qualityDivisor: number; // qualityFactor = clamp(rel/divisor, min, max)
  qualityMin: number;
  qualityMax: number;
  debtClearReputationBonus: number; // reputation bump when debt is fully repaid
  // Per-consequence beg penalties (relationship & reputation). 'reputation' uses the consequence amount.
  begPenalty: Record<ConsequenceKind, { relationship: number; reputation: number }>;
}

export const ECONOMY_TUNABLES: EconomyTunables = {
  startingRelationship: 60,
  relationshipBaseline: 60,
  reputationBaseline: 50,
  buyRelationshipGain: 2,
  buyReputationGain: 0.5,
  relationshipDriftPerSec: 0.5,
  reputationDriftPerSec: 0.3,
  refusalFloor: 15,
  qualityDivisor: 60,
  qualityMin: 0.4,
  qualityMax: 1,
  debtClearReputationBonus: 5,
  begPenalty: {
    debt: { relationship: 2, reputation: 1 }, // tolerated more
    chore: { relationship: 3, reputation: 1 },
    reputation: { relationship: 0, reputation: 0 }, // uses the consequence's own amount instead
    degraded: { relationship: 4, reputation: 2 },
  },
};
