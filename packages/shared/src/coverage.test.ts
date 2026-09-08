import { describe, expect, it } from 'vitest';
import { coverageOf } from './coverage.ts';

describe('coverageOf', () => {
  it('reports how many of a set were covered against the total', () => {
    expect(coverageOf(996, 1000)).toEqual({ covered: 996, total: 1000 });
  });

  it('reports 0/0 when there was nothing to cover', () => {
    expect(coverageOf(0, 0)).toEqual({ covered: 0, total: 0 });
  });

  it('never reduces the fraction', () => {
    expect(coverageOf(249, 250)).toEqual({ covered: 249, total: 250 });
  });
});
