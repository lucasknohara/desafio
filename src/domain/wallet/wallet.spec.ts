import { describe, expect, it } from 'bun:test';
import { Money } from '../money/money.js';
import { Wallet } from './wallet.js';

describe('Wallet', () => {
  it('opens with version one and the initial balance', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      currency: 'BRL',
      initialBalance: Money.fromDecimal('100.00', 'BRL'),
    });

    expect(wallet.balance.toDecimal()).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  it('increments the version only when the balance changes', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      currency: 'BRL',
      initialBalance: Money.fromDecimal('100.00', 'BRL'),
    });

    wallet.debit(Money.fromDecimal('25.00', 'BRL'));
    wallet.credit(Money.fromDecimal('5.00', 'BRL'));

    expect(wallet.balance.toDecimal()).toBe('80.00');
    expect(wallet.version).toBe(3);
  });

  it('rejects a debit that would make the balance negative', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      currency: 'BRL',
      initialBalance: Money.fromDecimal('10.00', 'BRL'),
    });

    expect(() => wallet.debit(Money.fromDecimal('10.01', 'BRL'))).toThrow(
      'Insufficient funds',
    );
    expect(wallet.balance.toDecimal()).toBe('10.00');
    expect(wallet.version).toBe(1);
  });

  it('rejects zero-value movements without changing the version', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      currency: 'BRL',
      initialBalance: Money.fromDecimal('10.00', 'BRL'),
    });

    const zero = Money.zero('BRL');

    expect(() => wallet.debit(zero)).toThrow(
      'Wallet movements must be positive',
    );
    expect(() => wallet.credit(zero)).toThrow(
      'Wallet movements must be positive',
    );
    expect(wallet.balance.toDecimal()).toBe('10.00');
    expect(wallet.version).toBe(1);
  });

  it('rehydrates persisted state', () => {
    const wallet = Wallet.rehydrate({
      id: 'wallet-1',
      playerId: 'player-1',
      currency: 'BRL',
      balance: '42.50',
      version: 7,
    });

    expect(wallet.balance.toDecimal()).toBe('42.50');
    expect(wallet.version).toBe(7);
  });
});
