import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WORLD, colorOf, mixInto } from './theme';

describe('the world colour theme', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(WORLD)).toBe(true);
  });

  it('every value is a lowercase 6-digit hex color', () => {
    for (const [key, value] of Object.entries(WORLD)) {
      expect(value, `${key} should be #rrggbb`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('exposes the semantic keys other areas depend on', () => {
    // A representative sample across groups; the registry is the contract.
    for (const key of ['ink', 'skyDayTop', 'meterCrit', 'rubleGold', 'panel'] as const) {
      expect(WORLD[key]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('names every light colour, so the rig holds no hex literals', () => {
    for (const key of ['sunNoon', 'sunLow', 'moonlight', 'bounce'] as const) {
      expect(WORLD[key]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('colour accessors', () => {
  it('hands back one shared instance per key, so a frame allocates nothing', () => {
    expect(colorOf('skyDayTop')).toBe(colorOf('skyDayTop'));
    expect(colorOf('skyDayTop')).not.toBe(colorOf('skyNightTop'));
  });

  it('parses the hex it was given', () => {
    expect(colorOf('cloud').getHexString()).toBe('ffffff');
    expect(colorOf('ink').getHexString()).toBe('1a1c2c');
  });

  it('mixes into a caller-owned target and returns it', () => {
    const target = new THREE.Color();
    expect(mixInto(target, 'ink', 'cloud', 0)).toBe(target);
    expect(target.getHexString()).toBe(colorOf('ink').getHexString());
    mixInto(target, 'ink', 'cloud', 1);
    expect(target.getHexString()).toBe('ffffff');
  });

  it('never lets a mix write back into the shared instances', () => {
    const target = new THREE.Color();
    mixInto(target, 'ink', 'cloud', 0.5);
    expect(colorOf('ink').getHexString()).toBe('1a1c2c');
    expect(colorOf('cloud').getHexString()).toBe('ffffff');
  });
});
