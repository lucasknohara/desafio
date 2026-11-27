import { describe, expect, it } from 'bun:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateWagerDto } from './create-wager.dto.js';

const validPayload = {
  providerId: 'provider-a',
  externalTransactionId: 'external-001',
  playerId: 'player-001',
  walletId: '00000000-0000-4000-8000-000000000001',
  roundId: 'round-001',
  type: 'BET',
  amount: '10.00',
  currency: 'BRL',
};

describe('CreateWagerDto', () => {
  it('accepts a valid transaction', async () => {
    const dto = plainToInstance(CreateWagerDto, validPayload);

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects amounts with more than two decimal places', async () => {
    const dto = plainToInstance(CreateWagerDto, {
      ...validPayload,
      amount: '10.001',
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });


  it('rejects a zero amount', async () => {
    const dto = plainToInstance(CreateWagerDto, {
      ...validPayload,
      amount: '0.00',
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects an empty provider identifier', async () => {
    const dto = plainToInstance(CreateWagerDto, {
      ...validPayload,
      providerId: '',
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
