import { describe, expect, it } from 'vitest';
import { ticketQueue } from '../../src/cli/tickets.ts';

describe('ticket queue', () => {
  it('puts every front ticket in order, then every back ticket', () => {
    expect(ticketQueue(['back-1', 'front-2', 'front-1'])).toEqual(['front-1', 'front-2', 'back-1']);
  });

  it('orders by number, not by text', () => {
    expect(ticketQueue(Array.from({ length: 10 }, (_, i) => `front-${10 - i}`)).at(-1)).toBe('front-10');
  });

  it('refuses a gap in a track', () => {
    expect(() => ticketQueue(['front-1', 'front-3'])).toThrow(/without gaps/);
  });

  it('refuses a folder that is not a ticket id', () => {
    expect(() => ticketQueue(['front-1', 'extra'])).toThrow(/front-<n> or back-<n>/);
  });

  it('is empty without folders', () => {
    expect(ticketQueue([])).toEqual([]);
  });
});
