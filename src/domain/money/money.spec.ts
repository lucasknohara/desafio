import { describe, expect, it } from 'bun:test';
import { Money } from './money.js';

describe('Money', () => {
  it.each([
    ['10', '10.00', 1000n],
    ['10.5', '10.50', 1050n],
    ['0.1', '0.10', 10n],
    ['10.12', '10.12', 1012n],
    ['10.13', '10.13', 1013n],
    ['0.01', '0.01', 1n],
  ] as const)('converts %s to %s', (input, expected, units) => {
    const money = Money.fromDecimal(input, 'BRL');

    expect(money.toDecimal()).toBe(expected);
    expect(money.toMinorUnits()).toBe(units);
  });

  it.each(['abc', '-1.00', '1,50', '1.', '.50', '', '1e3', '10.123'])(
    'rejects invalid amount %s',
    (value) => {
      expect(() => Money.fromDecimal(value, 'BRL')).toThrow('Invalid amount');
    },
  );

  it.each(['brl', 'BR', 'REAL', '123'])(
    'rejects invalid currency %s',
    (value) => {
      expect(() => Money.fromDecimal('1.00', value)).toThrow(
        'Invalid currency',
      );
    },
  );

  it('adds and subtracts exact amounts', () => {
    expect(
      Money.fromDecimal('10.25', 'BRL')
        .add(Money.fromDecimal('2.75', 'BRL'))
        .toDecimal(),
    ).toBe('13.00');

    expect(
      Money.fromDecimal('10.00', 'BRL')
        .subtract(Money.fromDecimal('0.35', 'BRL'))
        .toDecimal(),
    ).toBe('9.65');
  });

  it('prevents negative results and mixed currencies', () => {
    expect(() =>
      Money.fromDecimal('1.00', 'BRL').subtract(
        Money.fromDecimal('1.01', 'BRL'),
      ),
    ).toThrow();

    expect(() =>
      Money.fromDecimal('1.00', 'BRL').add(Money.fromDecimal('1.00', 'USD')),
    ).toThrow('Currency mismatch');
  });
});
