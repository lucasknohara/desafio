import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IsolationLevel,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { createHash, randomUUID } from 'node:crypto';
import { Money } from '../../domain/money/money.js';
import { Wallet as WalletAggregate } from '../../domain/wallet/wallet.js';
import { WagerTransaction as WagerTransactionState } from '../../domain/wagering/wager-transaction.js';
import { WalletEntity } from '../../database/entities/wallet.entity.js';
import { WagerTransactionEntity } from '../../database/entities/wager-transaction.entity.js';
import { LedgerEntryEntity } from '../../database/entities/ledger-entry.entity.js';
import { OutboxEventEntity } from '../../database/entities/outbox-event.entity.js';
import { CreateWalletDto } from './dto/create-wallet.dto.js';
import { MetricsService } from '../../infrastructure/observability/metrics.service.js';
import { StructuredLogger } from '../../infrastructure/observability/structured-logger.service.js';
import { WalletBalanceChangedEvent } from '../../domain/events/wallet-balance-changed.event.js';

@Injectable()
export class WalletsService {
  constructor(
    private readonly em: EntityManager,
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLogger,
  ) {}

  async create(dto: CreateWalletDto): Promise<Record<string, unknown>> {
    const opening = Money.fromDecimal(dto.openingBalance, dto.currency);
    try {
      return await this.em.transactional(async (tx) => {
        const existing = await tx.findOne(WalletEntity, {
          playerId: dto.playerId,
          currency: dto.currency,
        });
        if (existing)
          throw new ConflictException(
            'Wallet already exists for player and currency',
          );

        const wallet = new WalletEntity();
        const aggregateWallet = WalletAggregate.open({
          id: wallet.id,
          playerId: dto.playerId,
          currency: dto.currency,
          initialBalance: opening,
        });
        wallet.playerId = dto.playerId;
        wallet.currency = dto.currency;
        wallet.balance = aggregateWallet.balance.toDecimal();
        wallet.version = aggregateWallet.version;
        tx.persist(wallet);
        await tx.flush();

        if (opening.isPositive()) {
          const openingTransaction = new WagerTransactionEntity();
          openingTransaction.providerId = 'SYSTEM';
          openingTransaction.externalTransactionId = `OPENING-${wallet.id}`;
          openingTransaction.idempotencyKey = `OPENING-${wallet.id}`;
          openingTransaction.payloadHash = createHash('sha256')
            .update(`${wallet.id}:${opening.toDecimal()}`)
            .digest('hex');
          openingTransaction.playerId = wallet.playerId;
          openingTransaction.walletId = wallet.id;
          openingTransaction.roundId = 'OPENING';
          openingTransaction.type = 'OPENING';
          const openingState = WagerTransactionState.create();
          openingState.markProcessed();
          openingTransaction.status = openingState.status;
          openingTransaction.amount = opening.toDecimal();
          openingTransaction.currency = wallet.currency;
          openingTransaction.balanceAfter = opening.toDecimal();
          openingTransaction.processedAt = new Date();
          openingTransaction.responseSnapshot = {
            transactionId: openingTransaction.id,
            status: 'PROCESSED',
            balance: opening.toDecimal(),
            currency: wallet.currency,
            failureCode: null,
          };
          tx.persist(openingTransaction);
          await tx.flush();

          const ledger = new LedgerEntryEntity();
          ledger.walletId = wallet.id;
          ledger.transactionId = openingTransaction.id;
          ledger.direction = 'CREDIT';
          ledger.amount = opening.toDecimal();
          ledger.balanceBefore = '0.00';
          ledger.balanceAfter = opening.toDecimal();
          ledger.currency = wallet.currency;
          tx.persist(ledger);

          const integrationEvent = new WalletBalanceChangedEvent({
            eventId: randomUUID(),
            aggregateId: wallet.id,
            correlationId: openingTransaction.id,
            occurredAt: new Date(),
            data: {
              walletId: wallet.id,
              transactionId: openingTransaction.id,
              playerId: wallet.playerId,
              direction: 'CREDIT',
              money: { amount: opening.toDecimal(), currency: wallet.currency },
              balanceBefore: { amount: '0.00', currency: wallet.currency },
              balanceAfter: {
                amount: opening.toDecimal(),
                currency: wallet.currency,
              },
              walletVersion: wallet.version,
            },
          });
          const event = new OutboxEventEntity();
          event.id = integrationEvent.eventId;
          event.eventType = integrationEvent.eventType;
          event.aggregateId = integrationEvent.aggregateId;
          event.payload = integrationEvent.toJSON();
          tx.persist(event);
        }
        await tx.flush();
        return this.toWalletResponse(wallet);
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof UniqueConstraintViolationException) {
        throw new ConflictException(
          'Wallet already exists for player and currency',
        );
      }
      throw error;
    }
  }

  async findById(walletId: string): Promise<Record<string, unknown>> {
    const wallet = await this.em.findOne(WalletEntity, { id: walletId });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return this.toWalletResponse(wallet);
  }

  async getLedger(
    walletId: string,
    cursor?: string,
    rawLimit = '50',
  ): Promise<Record<string, unknown>> {
    const wallet = await this.em.findOne(WalletEntity, { id: walletId });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (!/^\d+$/.test(rawLimit))
      throw new BadRequestException('Invalid ledger limit');
    const requestedLimit = Number(rawLimit);
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
      throw new BadRequestException('Invalid ledger limit');
    }
    const limit = Math.min(requestedLimit, 100);
    const where: Record<string, unknown> = { walletId };
    if (cursor) {
      let decoded: { createdAt: string; id: string };
      try {
        decoded = JSON.parse(
          Buffer.from(cursor, 'base64url').toString('utf8'),
        ) as { createdAt: string; id: string };
      } catch {
        throw new BadRequestException('Invalid ledger cursor');
      }
      const date = new Date(decoded.createdAt);
      if (
        Number.isNaN(date.getTime()) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          decoded.id,
        )
      ) {
        throw new BadRequestException('Invalid ledger cursor');
      }
      where['$or'] = [
        { createdAt: { $lt: date } },
        { createdAt: date, id: { $lt: decoded.id } },
      ];
    }
    const rows = await this.em.find(LedgerEntryEntity, where as never, {
      limit: limit + 1,
      orderBy: { createdAt: 'DESC', id: 'DESC' },
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      hasMore && last
        ? Buffer.from(
            JSON.stringify({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            }),
          ).toString('base64url')
        : null;
    return {
      walletId,
      items: page.map((entry) => ({
        id: entry.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        amount: entry.amount,
        balanceBefore: entry.balanceBefore,
        balanceAfter: entry.balanceAfter,
        currency: entry.currency,
        createdAt: entry.createdAt,
      })),
      nextCursor,
    };
  }

  async reconcile(walletId: string): Promise<Record<string, unknown>> {
    return this.em.fork().transactional(
      async (tx) => {
        const wallet = await tx.findOne(WalletEntity, { id: walletId });
        if (!wallet) throw new NotFoundException('Wallet not found');
        const entries = await tx.find(LedgerEntryEntity, { walletId });
        let calculatedMinor = 0n;
        for (const entry of entries) {
          const amount = Money.fromDecimal(
            entry.amount,
            entry.currency,
          ).toMinorUnits();
          calculatedMinor += entry.direction === 'CREDIT' ? amount : -amount;
        }
        const calculatedBalance = this.formatSignedMinor(calculatedMinor);
        const storedMinor = Money.fromDecimal(
          wallet.balance,
          wallet.currency,
        ).toMinorUnits();
        const difference = this.formatSignedMinor(
          storedMinor - calculatedMinor,
        );
        const consistent = storedMinor === calculatedMinor;
        if (!consistent) {
          this.metrics.increment('wallet_reconciliation_mismatches_total');
          this.logger.error(
            'wallet_reconciliation_mismatch',
            new Error('Ledger balance does not match wallet balance'),
            {
              walletId,
              checkedEntries: entries.length,
            },
          );
        }

        return {
          walletId,
          storedBalance: wallet.balance,
          calculatedBalance,
          difference,
          consistent,
          checkedEntries: entries.length,
        };
      },
      { isolationLevel: IsolationLevel.REPEATABLE_READ },
    );
  }

  private toWalletResponse(wallet: WalletEntity): Record<string, unknown> {
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balance: wallet.balance,
      version: wallet.version,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }

  private formatSignedMinor(value: bigint): string {
    const negative = value < 0n;
    const absolute = negative ? -value : value;
    const digits = absolute.toString().padStart(3, '0');
    return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
  }
}
