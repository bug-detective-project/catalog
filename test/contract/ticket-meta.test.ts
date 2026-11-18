import { describe, expect, it } from 'vitest';
import { parseTicketMeta, ticketMetaOf } from '../../src/contract/ticket-meta.ts';

const skills = { en: ['Building components'], pt: ['Criação de componentes'] };
const FILE = 'tickets/front-1/ticket.json';

describe('ticket.json', () => {
  it('accepts a full ticket.json', () => {
    expect(parseTicketMeta({ type: 'build', bothSides: true, skills }, FILE)).toEqual({
      type: 'build',
      bothSides: true,
      skills,
    });
  });

  it('accepts an empty object', () => {
    expect(parseTicketMeta({}, FILE)).toEqual({});
  });

  it.each([
    [{ type: 'bug' }, 'type'],
    // No ticket asks the player to write tests: the type that existed for it was dropped in 1.7.0.
    [{ type: 'test' }, 'type'],
    [{ skills: { en: [], pt: [] } }, 'skills'],
    [{ skills: { en: ['A', 'B'], pt: ['A'] } }, 'skills'],
    [{ skills: { en: ['A', 'A'], pt: ['A', 'B'] } }, 'skills'],
    [{ skills: { en: ['1', '2', '3', '4', '5', '6'], pt: ['1', '2', '3', '4', '5', '6'] } }, 'skills'],
    [{ skills: { en: ['x'.repeat(61)], pt: ['y'] } }, 'skills'],
    [{ skills: { en: ['A'] } }, 'skills'],
    [{ extra: 1 }, 'extra'],
    [[], 'file'],
  ])('rejects %j naming %s', (raw, field) => {
    expect(() => parseTicketMeta(raw, FILE)).toThrow(new RegExp(`Invalid tickets/front-1/ticket.json: .*${field}`));
  });

  it('gives {} for a package without the file', () => {
    expect(ticketMetaOf([], 'front-1')).toEqual({});
  });

  it('reads the file of a package', () => {
    const data = new TextEncoder().encode(JSON.stringify({ type: 'optimize' }));
    expect(ticketMetaOf([{ path: 'ticket.json', data, executable: false }], 'back-2')).toEqual({ type: 'optimize' });
  });

  it('names the file when the JSON is broken', () => {
    const file = { path: 'ticket.json', data: new TextEncoder().encode('{'), executable: false };
    expect(() => ticketMetaOf([file], 'front-1')).toThrow('Invalid tickets/front-1/ticket.json: not valid JSON');
  });
});
