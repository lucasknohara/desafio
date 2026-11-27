import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LockMode, UniqueConstraintViolationException } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { createHash, randomUUID } from 'node:crypto';
import { Money } from '../../domain/money/money.js';
import { Wallet as WalletAggregate } from '../../domain/wallet/wallet.js';
import { WagerTransaction as WagerTransactionState } from '../../domain/wagering/wager-transaction.js';
import { WalletEntity } from '../../database/entities/wallet.entity.js';
import {
  WagerTransactionEntity,
  WagerResponseSnapshot,
  WagerType,
} from '../../database/entities/wager-transaction.entity.js';
import { LedgerEntryEntity } from '../../database/entities/ledger-entry.entity.js';
import { InboxMessageEntity } from '../../database/entities/inbox-message.entity.js';
import { OutboxEventEntity } from '../../database/entities/outbox-event.entity.js';
import { CreateWagerDto } from './dto/create-wager.dto.js';
import { MetricsService } from '../../infrastructure/observability/metrics.service.js';
import { StructuredLogger } from '../../infrastructure/observability/structured-logger.service.js';
import {
  IntegrationEvent,
  IntegrationEventMetadata,
} from '../../domain/events/integration-event.js';
import { WagerTransactionProcessedEvent } from '../../domain/events/wager-transaction-processed.event.js';
import { WagerTransactionRejectedEvent } from '../../domain/events/wager-transaction-rejected.event.js';
import { WagerTransactionPendingReferenceEvent } from '../../domain/events/wager-transaction-pending-reference.event.js';
import { WalletBalanceChangedEvent } from '../../domain/events/wallet-balance-changed.event.js';

export interface InboxContext {
  consumerName: string;
  messageId: string;
}
export interface WagerResult extends WagerResponseSnapshot {
  idempotentReplay: boolean;
}

@Injectable()
export class WageringService {
  constructor(
    private readonly em: EntityManager,
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLogger,
  ) {}

  async process(
    dto: CreateWagerDto,
    idempotencyKey: string,
    inbox?: InboxContext,
    correlationId?: string,
  ): Promise<WagerResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.processOnce(
          dto,
          idempotencyKey,
          inbox,
          correlationId,
        );
      } catch (error) {
        const code = this.databaseErrorCode(error);
        const retryable = ['40001', '40P01', '55P03'].includes(code);
        if (!retryable || attempt === 2) throw error;
        this.metrics.increment('wallet_lock_conflicts_total');
        await new Promise((resolve) => setTimeout(resolve, 40 * 2 ** attempt));
      }
    }
    throw new Error('Wager transaction retry limit reached');
  }

  private async processOnce(
    dto: CreateWagerDto,
    idempotencyKey: string,
    inbox?: InboxContext,
    correlationId?: string,
  ): Promise<WagerResult> {
    const normalizedIdempotencyKey = idempotencyKey.trim();
    if (!normalizedIdempotencyKey || normalizedIdempotencyKey.length > 180) {
      throw new ConflictException(
        'Idempotency-Key must contain 1 to 180 characters',
      );
    }
    const started = Date.now();
    const payloadHash = this.hashCanonicalPayload(dto);
    const em = this.em.fork();
    try {
      const result = await em.transactional(async (tx) => {
        await tx.execute("set local lock_timeout = '3000ms'");
        let inboxRecord: InboxMessageEntity | null = null;
        if (inbox) {
          const priorMessage = await tx.findOne(InboxMessageEntity, {
            consumerName: inbox.consumerName,
            messageId: inbox.messageId,
          });
          if (priorMessage) {
            if (
              priorMessage.payloadHash &&
              priorMessage.payloadHash !== payloadHash
            ) {
              throw new ConflictException(
                'SQS message was already processed with a different payload',
              );
            }
            this.metrics.increment('wager_idempotent_replay_total');
            if (!priorMessage.transactionId)
              throw new Error(
                'Inbox record is missing its transaction reference',
              );
            const original = await tx.findOne(WagerTransactionEntity, {
              id: priorMessage.transactionId,
            });
            if (!original)
              throw new Error('Inbox record references a missing transaction');
            return this.toReplay(original);
          }
          inboxRecord = new InboxMessageEntity();
          inboxRecord.consumerName = inbox.consumerName;
          inboxRecord.messageId = inbox.messageId;
          inboxRecord.payloadHash = payloadHash;
          inboxRecord.processedAt = new Date();
          tx.persist(inboxRecord);
        }

        const prior = await tx.findOne(WagerTransactionEntity, {
          providerId: dto.providerId,
          idempotencyKey: normalizedIdempotencyKey,
        });
        if (prior) {
          if (prior.payloadHash !== payloadHash) {
            throw new ConflictException(
              'Idempotency-Key was already used with a different payload',
            );
          }
          this.metrics.increment('wager_idempotent_replay_total');
          if (inboxRecord) inboxRecord.transactionId = prior.id;
          return this.toReplay(prior);
        }

        const amount = Money.fromDecimal(dto.amount, dto.currency);
        if (!amount.isPositive())
          throw new BadRequestException(
            'Transaction amount must be greater than zero',
          );

        const wallet = await tx.findOne(
          WalletEntity,
          { id: dto.walletId },
          {
            lockMode: LockMode.PESSIMISTIC_WRITE,
          },
        );
        if (!wallet) throw new NotFoundException('Wallet not found');

        const priorAfterWalletLock = await tx.findOne(WagerTransactionEntity, {
          providerId: dto.providerId,
          idempotencyKey: normalizedIdempotencyKey,
        });
        if (priorAfterWalletLock) {
          if (priorAfterWalletLock.payloadHash !== payloadHash) {
            throw new ConflictException(
              'Idempotency-Key was already used with a different payload',
            );
          }
          this.metrics.increment('wager_idempotent_replay_total');
          if (inboxRecord) inboxRecord.transactionId = priorAfterWalletLock.id;
          return this.toReplay(priorAfterWalletLock);
        }

        const transaction = new WagerTransactionEntity();
        transaction.providerId = dto.providerId;
        transaction.externalTransactionId = dto.externalTransactionId;
        transaction.idempotencyKey = normalizedIdempotencyKey;
        transaction.payloadHash = payloadHash;
        transaction.playerId = dto.playerId;
        transaction.walletId = dto.walletId;
        transaction.roundId = dto.roundId;
        transaction.correlationId =
          correlationId ?? inbox?.messageId ?? transaction.id;
        transaction.type = dto.type;
        transaction.status = WagerTransactionState.create().status;
        transaction.amount = amount.toDecimal();
        transaction.currency = dto.currency;
        transaction.referenceExternalTransactionId =
          dto.referenceExternalTransactionId ?? null;
        tx.persist(transaction);
        if (inboxRecord) inboxRecord.transactionId = transaction.id;
        await tx.flush();
        const eventMetadata = this.createEventMetadata(
          transaction.id,
          transaction.walletId,
          transaction.correlationId ?? transaction.id,
          inbox?.messageId,
        );

        if (
          wallet.playerId !== dto.playerId ||
          wallet.currency !== dto.currency
        ) {
          return this.reject(
            tx,
            transaction,
            'WALLET_IDENTITY_MISMATCH',
            wallet.balance,
            wallet.currency,
            eventMetadata,
          );
        }
        let reference: WagerTransactionEntity | null = null;
        const referenceIsRequired =
          dto.type === 'REFUND' || dto.type === 'ROLLBACK';
        if (dto.referenceExternalTransactionId) {
          reference = await tx.findOne(WagerTransactionEntity, {
            providerId: dto.providerId,
            externalTransactionId: dto.referenceExternalTransactionId,
          });
          if (!reference) {
            return this.markPendingReference(
              tx,
              transaction,
              wallet.balance,
              wallet.currency,
              eventMetadata,
            );
          }
          const referenceError = this.validateReference(dto, reference, amount);
          if (referenceError)
            return this.reject(
              tx,
              transaction,
              referenceError,
              wallet.balance,
              wallet.currency,
              eventMetadata,
            );
        } else if (referenceIsRequired) {
          return this.reject(
            tx,
            transaction,
            'REFERENCE_REQUIRED',
            wallet.balance,
            wallet.currency,
            eventMetadata,
          );
        }

        const aggregateWallet = WalletAggregate.rehydrate(wallet);
        const before = aggregateWallet.balance;
        let after = before;
        let direction: 'CREDIT' | 'DEBIT' | null = null;
        let shouldChangeBalance = false;

        if (dto.type === 'BET') {
          if (!aggregateWallet.hasFunds(amount))
            return this.reject(
              tx,
              transaction,
              'INSUFFICIENT_FUNDS',
              wallet.balance,
              wallet.currency,
              eventMetadata,
            );
          aggregateWallet.debit(amount);
          after = aggregateWallet.balance;
          direction = 'DEBIT';
          shouldChangeBalance = true;
        } else if (dto.type === 'WIN') {
          aggregateWallet.credit(amount);
          after = aggregateWallet.balance;
          direction = 'CREDIT';
          shouldChangeBalance = true;
        } else if (dto.type === 'REFUND') {
          aggregateWallet.credit(amount);
          after = aggregateWallet.balance;
          direction = 'CREDIT';
          shouldChangeBalance = true;
        } else if (dto.type === 'ROLLBACK') {
          if (!reference)
            return this.reject(
              tx,
              transaction,
              'REFERENCE_REQUIRED',
              wallet.balance,
              wallet.currency,
              eventMetadata,
            );
          const reverseIsDebit =
            reference.type === 'WIN' || reference.type === 'REFUND';
          if (reverseIsDebit) {
            if (!aggregateWallet.hasFunds(amount))
              return this.reject(
                tx,
                transaction,
                'INSUFFICIENT_FUNDS_FOR_REVERSAL',
                wallet.balance,
                wallet.currency,
                eventMetadata,
              );
            aggregateWallet.debit(amount);
            after = aggregateWallet.balance;
            direction = 'DEBIT';
          } else {
            aggregateWallet.credit(amount);
            after = aggregateWallet.balance;
            direction = 'CREDIT';
          }
          shouldChangeBalance = true;
        }

        if (shouldChangeBalance) {
          wallet.balance = aggregateWallet.balance.toDecimal();
          wallet.version = aggregateWallet.version;
          const ledger = new LedgerEntryEntity();
          ledger.walletId = wallet.id;
          ledger.transactionId = transaction.id;
          if (!direction) throw new Error('Missing ledger direction');
          ledger.direction = direction;
          ledger.amount = amount.toDecimal();
          ledger.balanceBefore = before.toDecimal();
          ledger.balanceAfter = after.toDecimal();
          ledger.currency = wallet.currency;
          tx.persist(ledger);
        }

        if (reference && (dto.type === 'REFUND' || dto.type === 'ROLLBACK')) {
          reference.reversedTransactionId = transaction.id;
          transaction.referenceTransactionId = reference.id;
        } else if (reference) {
          transaction.referenceTransactionId = reference.id;
        }

        const transactionState = WagerTransactionState.rehydrate(
          transaction.status,
        );
        transactionState.markProcessed();
        transaction.status = transactionState.status;
        transaction.balanceAfter = after.toDecimal();
        transaction.processedAt = new Date();
        transaction.failureCode = null;
        transaction.responseSnapshot = this.snapshot(
          transaction,
          after.toDecimal(),
          null,
        );

        this.addOutbox(
          tx,
          new WagerTransactionProcessedEvent({
            ...this.createEventMetadata(
              transaction.id,
              wallet.id,
              eventMetadata.correlationId,
              eventMetadata.causationId,
            ),
            data: {
              transactionId: transaction.id,
              providerId: transaction.providerId,
              externalTransactionId: transaction.externalTransactionId,
              playerId: wallet.playerId,
              walletId: wallet.id,
              type: transaction.type,
              amount: {
                amount: transaction.amount,
                currency: wallet.currency,
              },
              status: 'PROCESSED',
              balance: { amount: wallet.balance, currency: wallet.currency },
            },
          }),
        );
        if (shouldChangeBalance && direction) {
          this.addOutbox(
            tx,
            new WalletBalanceChangedEvent({
              ...this.createEventMetadata(
                transaction.id,
                wallet.id,
                eventMetadata.correlationId,
                eventMetadata.causationId,
              ),
              data: {
                walletId: wallet.id,
                transactionId: transaction.id,
                playerId: wallet.playerId,
                direction,
                money: {
                  amount: amount.toDecimal(),
                  currency: wallet.currency,
                },
                balanceBefore: {
                  amount: before.toDecimal(),
                  currency: wallet.currency,
                },
                balanceAfter: {
                  amount: after.toDecimal(),
                  currency: wallet.currency,
                },
                walletVersion: wallet.version,
              },
            }),
          );
        }
        return { ...transaction.responseSnapshot!, idempotentReplay: false };
      });
      this.metrics.increment('wager_transactions_total', {
        status: result.status,
      });
      this.metrics.observeProcessingMs(Date.now() - started);
      this.logger.log('wager_transaction_handled', {
        transactionId: result.transactionId,
        walletId: dto.walletId,
        providerId: dto.providerId,
        status: result.status,
        transactionType: dto.type,
        correlationId:
          correlationId ?? inbox?.messageId ?? result.transactionId,
        messageId: inbox?.messageId ?? null,
      });
      return result;
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        const prior = await em.findOne(WagerTransactionEntity, {
          providerId: dto.providerId,
          idempotencyKey: normalizedIdempotencyKey,
        });
        if (prior) {
          if (prior.payloadHash !== payloadHash)
            throw new ConflictException(
              'Idempotency-Key was already used with a different payload',
            );
          return this.toReplay(prior);
        }
        const external = await em.findOne(WagerTransactionEntity, {
          providerId: dto.providerId,
          externalTransactionId: dto.externalTransactionId,
        });
        if (external)
          throw new ConflictException(
            'External transaction already exists for this provider',
          );
      }
      throw error;
    }
  }

  async findById(transactionId: string): Promise<Record<string, unknown>> {
    const row = await this.em
      .fork()
      .findOne(WagerTransactionEntity, { id: transactionId });
    if (!row) throw new NotFoundException('Wager transaction not found');
    return this.toTransactionResponse(row);
  }

  async findByProviderExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<Record<string, unknown>> {
    const row = await this.em
      .fork()
      .findOne(WagerTransactionEntity, { providerId, externalTransactionId });
    if (!row) throw new NotFoundException('Wager transaction not found');
    return this.toTransactionResponse(row);
  }

  async retryPendingReference(transactionId: string): Promise<void> {
    const em = this.em.fork();
    await em.transactional(async (tx) => {
      const pending = await tx.findOne(
        WagerTransactionEntity,
        { id: transactionId, status: 'PENDING_REFERENCE' },
        {
          lockMode: LockMode.PESSIMISTIC_WRITE,
        },
      );
      if (
        !pending ||
        (pending.nextAttemptAt && pending.nextAttemptAt > new Date())
      )
        return;
      const refExternal = pending.referenceExternalTransactionId;
      if (!refExternal) {
        await this.rejectPending(
          tx,
          pending,
          'REFERENCE_REQUIRED',
          pending.balanceAfter ?? '0.00',
        );
        return;
      }
      const reference = await tx.findOne(WagerTransactionEntity, {
        providerId: pending.providerId,
        externalTransactionId: refExternal,
      });
      if (!reference) {
        pending.attempts += 1;
        if (
          pending.attempts >= 12 ||
          Date.now() - pending.createdAt.getTime() > 86_400_000
        ) {
          await this.rejectPending(
            tx,
            pending,
            'REFERENCE_NOT_FOUND_TIMEOUT',
            pending.balanceAfter ?? '0.00',
          );
          return;
        }
        const backoff = Math.min(2 ** pending.attempts * 1000, 300_000);
        pending.nextAttemptAt = new Date(Date.now() + backoff);
        return;
      }

      const wallet = await tx.findOne(
        WalletEntity,
        { id: pending.walletId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!wallet) {
        await this.rejectPending(tx, pending, 'WALLET_NOT_FOUND', '0.00');
        return;
      }
      const amount = Money.fromDecimal(pending.amount, pending.currency);
      const dto = {
        providerId: pending.providerId,
        externalTransactionId: pending.externalTransactionId,
        playerId: pending.playerId,
        walletId: pending.walletId,
        roundId: pending.roundId,
        type: pending.type as Exclude<WagerType, 'OPENING'>,
        amount: pending.amount,
        currency: pending.currency,
        referenceExternalTransactionId: refExternal,
      } as CreateWagerDto;
      const referenceError = this.validateReference(dto, reference, amount);
      if (referenceError) {
        await this.rejectPending(tx, pending, referenceError, wallet.balance);
        return;
      }

      const aggregateWallet = WalletAggregate.rehydrate(wallet);
      const before = aggregateWallet.balance;
      let after = before;
      let direction: 'CREDIT' | 'DEBIT' = 'CREDIT';
      if (pending.type === 'BET') {
        if (!aggregateWallet.hasFunds(amount)) {
          await this.rejectPending(
            tx,
            pending,
            'INSUFFICIENT_FUNDS',
            wallet.balance,
          );
          return;
        }
        aggregateWallet.debit(amount);
        after = aggregateWallet.balance;
        direction = 'DEBIT';
      } else if (pending.type === 'REFUND') {
        aggregateWallet.credit(amount);
        after = aggregateWallet.balance;
      } else if (pending.type === 'ROLLBACK') {
        if (reference.type === 'WIN' || reference.type === 'REFUND') {
          if (!aggregateWallet.hasFunds(amount)) {
            await this.rejectPending(
              tx,
              pending,
              'INSUFFICIENT_FUNDS_FOR_REVERSAL',
              wallet.balance,
            );
            return;
          }
          aggregateWallet.debit(amount);
          after = aggregateWallet.balance;
          direction = 'DEBIT';
        } else {
          aggregateWallet.credit(amount);
          after = aggregateWallet.balance;
        }
      } else if (pending.type === 'WIN') {
        aggregateWallet.credit(amount);
        after = aggregateWallet.balance;
      }
      if (pending.type !== 'LOSS') {
        wallet.balance = aggregateWallet.balance.toDecimal();
        wallet.version = aggregateWallet.version;
        const ledger = new LedgerEntryEntity();
        ledger.walletId = wallet.id;
        ledger.transactionId = pending.id;
        ledger.direction = direction;
        ledger.amount = amount.toDecimal();
        ledger.balanceBefore = before.toDecimal();
        ledger.balanceAfter = after.toDecimal();
        ledger.currency = wallet.currency;
        tx.persist(ledger);
      }
      if (pending.type === 'REFUND' || pending.type === 'ROLLBACK')
        reference.reversedTransactionId = pending.id;
      pending.referenceTransactionId = reference.id;
      const pendingState = WagerTransactionState.rehydrate(pending.status);
      pendingState.markProcessed();
      pending.status = pendingState.status;
      pending.processedAt = new Date();
      pending.balanceAfter = after.toDecimal();
      pending.nextAttemptAt = null;
      pending.failureCode = null;
      const eventMetadata = this.createEventMetadata(
        pending.id,
        wallet.id,
        pending.correlationId ?? pending.id,
        pending.id,
      );
      this.addOutbox(
        tx,
        new WagerTransactionProcessedEvent({
          ...eventMetadata,
          data: {
            transactionId: pending.id,
            providerId: pending.providerId,
            externalTransactionId: pending.externalTransactionId,
            playerId: wallet.playerId,
            walletId: wallet.id,
            type: pending.type,
            amount: { amount: pending.amount, currency: pending.currency },
            status: 'PROCESSED',
            balance: { amount: wallet.balance, currency: wallet.currency },
          },
        }),
      );
      if (pending.type !== 'LOSS') {
        this.addOutbox(
          tx,
          new WalletBalanceChangedEvent({
            ...this.createEventMetadata(
              pending.id,
              wallet.id,
              pending.correlationId ?? pending.id,
              pending.id,
            ),
            data: {
              walletId: wallet.id,
              transactionId: pending.id,
              playerId: wallet.playerId,
              direction,
              money: { amount: amount.toDecimal(), currency: wallet.currency },
              balanceBefore: {
                amount: before.toDecimal(),
                currency: wallet.currency,
              },
              balanceAfter: {
                amount: after.toDecimal(),
                currency: wallet.currency,
              },
              walletVersion: wallet.version,
            },
          }),
        );
      }
    });
  }

  private databaseErrorCode(error: unknown): string {
    let current: unknown = error;
    for (
      let depth = 0;
      depth < 4 && current && typeof current === 'object';
      depth += 1
    ) {
      if ('code' in current) {
        const code = (current as { code?: unknown }).code;
        if (typeof code === 'string') return code;
      }
      current =
        'cause' in current ? (current as { cause?: unknown }).cause : null;
    }
    return '';
  }

  private validateReference(
    dto: CreateWagerDto,
    ref: WagerTransactionEntity,
    amount: Money,
  ): string | null {
    if (ref.status !== 'PROCESSED') return 'REFERENCE_NOT_PROCESSED';
    if (
      ref.providerId !== dto.providerId ||
      ref.playerId !== dto.playerId ||
      ref.walletId !== dto.walletId ||
      ref.currency !== dto.currency ||
      ref.roundId !== dto.roundId
    ) {
      return 'REFERENCE_SCOPE_MISMATCH';
    }
    if (
      (dto.type === 'REFUND' || dto.type === 'ROLLBACK') &&
      amount.compare(Money.fromDecimal(ref.amount, ref.currency)) !== 0
    )
      return 'REFERENCE_AMOUNT_MISMATCH';
    if (dto.type === 'REFUND' && ref.type !== 'BET')
      return 'REFUND_REQUIRES_PROCESSED_BET';
    if (dto.type === 'ROLLBACK' && !['BET', 'WIN', 'REFUND'].includes(ref.type))
      return 'ROLLBACK_REFERENCE_TYPE_INVALID';
    if (
      (dto.type === 'REFUND' || dto.type === 'ROLLBACK') &&
      ref.reversedTransactionId
    )
      return 'REFERENCE_ALREADY_REVERSED';
    if (dto.type === 'WIN' && ref.type !== 'BET')
      return 'WIN_REFERENCE_MUST_BE_BET';
    return null;
  }

  private async markPendingReference(
    tx: EntityManager,
    transaction: WagerTransactionEntity,
    balance: string,
    currency: string,
    metadata: IntegrationEventMetadata,
  ): Promise<WagerResult> {
    const transactionState = WagerTransactionState.rehydrate(
      transaction.status,
    );
    transactionState.markPendingReference();
    transaction.status = transactionState.status;
    transaction.balanceAfter = balance;
    transaction.attempts = 0;
    transaction.nextAttemptAt = new Date(Date.now() + 1000);
    transaction.responseSnapshot = this.snapshot(transaction, balance, null);
    this.addOutbox(
      tx,
      new WagerTransactionPendingReferenceEvent({
        ...this.createEventMetadata(
          transaction.id,
          transaction.walletId,
          metadata.correlationId,
          metadata.causationId,
        ),
        data: {
          transactionId: transaction.id,
          providerId: transaction.providerId,
          externalTransactionId: transaction.externalTransactionId,
          referenceExternalTransactionId:
            transaction.referenceExternalTransactionId,
          walletId: transaction.walletId,
          status: 'PENDING_REFERENCE',
          amount: { amount: transaction.amount, currency },
        },
      }),
    );
    return { ...transaction.responseSnapshot, idempotentReplay: false };
  }

  private async reject(
    tx: EntityManager,
    transaction: WagerTransactionEntity,
    failureCode: string,
    balance: string,
    currency: string,
    metadata: IntegrationEventMetadata,
  ): Promise<WagerResult> {
    const transactionState = WagerTransactionState.rehydrate(
      transaction.status,
    );
    transactionState.reject();
    transaction.status = transactionState.status;
    transaction.failureCode = failureCode;
    transaction.balanceAfter = balance;
    transaction.processedAt = new Date();
    transaction.responseSnapshot = this.snapshot(
      transaction,
      balance,
      failureCode,
    );
    this.addOutbox(
      tx,
      new WagerTransactionRejectedEvent({
        ...this.createEventMetadata(
          transaction.id,
          transaction.walletId,
          metadata.correlationId,
          metadata.causationId,
        ),
        data: {
          transactionId: transaction.id,
          providerId: transaction.providerId,
          externalTransactionId: transaction.externalTransactionId,
          walletId: transaction.walletId,
          failureCode,
          status: 'REJECTED',
          amount: { amount: transaction.amount, currency },
        },
      }),
    );
    return { ...transaction.responseSnapshot, idempotentReplay: false };
  }

  private async rejectPending(
    tx: EntityManager,
    transaction: WagerTransactionEntity,
    failureCode: string,
    balance: string,
  ): Promise<void> {
    const transactionState = WagerTransactionState.rehydrate(
      transaction.status,
    );
    transactionState.reject();
    transaction.status = transactionState.status;
    transaction.failureCode = failureCode;
    transaction.balanceAfter = balance;
    transaction.processedAt = new Date();
    transaction.nextAttemptAt = null;
    this.addOutbox(
      tx,
      new WagerTransactionRejectedEvent({
        ...this.createEventMetadata(
          transaction.id,
          transaction.walletId,
          transaction.correlationId ?? transaction.id,
          transaction.id,
        ),
        data: {
          transactionId: transaction.id,
          providerId: transaction.providerId,
          externalTransactionId: transaction.externalTransactionId,
          walletId: transaction.walletId,
          failureCode,
          status: 'REJECTED',
          amount: {
            amount: transaction.amount,
            currency: transaction.currency,
          },
        },
      }),
    );
  }

  private snapshot(
    transaction: WagerTransactionEntity,
    balance: string,
    failureCode: string | null,
  ): WagerResponseSnapshot {
    return {
      transactionId: transaction.id,
      status: transaction.status,
      balance,
      currency: transaction.currency,
      failureCode,
    };
  }

  private toReplay(transaction: WagerTransactionEntity): WagerResult {
    const snapshot =
      transaction.responseSnapshot ??
      this.snapshot(
        transaction,
        transaction.balanceAfter ?? '0.00',
        transaction.failureCode,
      );
    return { ...snapshot, idempotentReplay: true };
  }

  private toTransactionResponse(
    transaction: WagerTransactionEntity,
  ): Record<string, unknown> {
    return {
      id: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      playerId: transaction.playerId,
      walletId: transaction.walletId,
      roundId: transaction.roundId,
      type: transaction.type,
      status: transaction.status,
      amount: transaction.amount,
      currency: transaction.currency,
      referenceExternalTransactionId:
        transaction.referenceExternalTransactionId,
      referenceTransactionId: transaction.referenceTransactionId,
      balanceAfter: transaction.balanceAfter,
      failureCode: transaction.failureCode,
      attempts: transaction.attempts,
      createdAt: transaction.createdAt,
      processedAt: transaction.processedAt,
    };
  }

  private addOutbox(
    tx: EntityManager,
    integrationEvent: IntegrationEvent<object>,
  ): void {
    const event = new OutboxEventEntity();
    event.id = integrationEvent.eventId;
    event.eventType = integrationEvent.eventType;
    event.aggregateId = integrationEvent.aggregateId;
    event.payload = integrationEvent.toJSON();
    tx.persist(event);
  }

  private createEventMetadata(
    transactionId: string,
    walletId: string,
    correlationId?: string,
    causationId?: string,
  ): IntegrationEventMetadata {
    return {
      eventId: randomUUID(),
      aggregateId: walletId,
      correlationId: correlationId ?? transactionId,
      causationId,
      occurredAt: new Date(),
    };
  }

  private hashCanonicalPayload(dto: CreateWagerDto): string {
    const canonical = this.canonicalize(dto);
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  private canonicalize(value: unknown): unknown {
    if (Array.isArray(value))
      return value.map((item) => this.canonicalize(item));
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, this.canonicalize(record[key])]),
      );
    }
    return value;
  }
}
