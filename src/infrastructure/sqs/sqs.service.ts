import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { createHash } from 'node:crypto';

@Injectable()
export class SqsService implements OnModuleDestroy {
  private readonly client: SQSClient;
  readonly enabled =
    (process.env.SQS_ENABLED ?? 'true').toLowerCase() === 'true';
  readonly wagerQueueUrl = process.env.SQS_WAGER_QUEUE_URL ?? '';
  readonly eventsQueueUrl = process.env.SQS_EVENTS_QUEUE_URL ?? '';
  readonly dlqUrl = process.env.SQS_DLQ_URL ?? '';

  constructor() {
    this.client = new SQSClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
      endpoint: process.env.AWS_ENDPOINT_URL || undefined,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
      },
    });
  }

  async enqueueWager(
    payload: Record<string, unknown>,
    idempotencyKey: string,
    walletId: string,
    correlationId: string,
  ): Promise<void> {
    if (!this.enabled) throw new Error('SQS is disabled');
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.wagerQueueUrl,
        MessageBody: JSON.stringify({
          ...payload,
          idempotencyKey,
          correlationId,
        }),
        MessageGroupId: walletId,
        MessageDeduplicationId: createHash('sha256')
          .update(
            `${idempotencyKey}:${createHash('sha256')
              .update(JSON.stringify(this.canonicalize(payload)))
              .digest('hex')}`,
          )
          .digest('hex'),
      }),
    );
  }

  async publishEvent(
    eventId: string,
    aggregateId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.enabled) return;
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.eventsQueueUrl,
        MessageBody: JSON.stringify(payload),
        MessageGroupId: aggregateId,
        MessageDeduplicationId: eventId,
      }),
    );
  }

  async receiveWagers() {
    if (!this.enabled) return [];
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.wagerQueueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
        VisibilityTimeout: 45,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
    );
    return response.Messages ?? [];
  }

  async deferMessage(
    message: { ReceiptHandle?: string },
    seconds: number,
  ): Promise<void> {
    if (!message.ReceiptHandle) return;
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.wagerQueueUrl,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: Math.min(Math.max(seconds, 1), 43200),
      }),
    );
  }

  async acknowledge(message: { ReceiptHandle?: string }): Promise<void> {
    if (!message.ReceiptHandle) return;
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.wagerQueueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }

  async checkReady(): Promise<void> {
    if (!this.enabled) throw new Error('SQS is disabled');
    await this.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: this.wagerQueueUrl,
        AttributeNames: ['QueueArn'],
      }),
    );
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

  async getDlqApproximateCount(): Promise<number> {
    if (!this.enabled || !this.dlqUrl) return 0;
    const result = await this.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: this.dlqUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }),
    );
    return Number(result.Attributes?.ApproximateNumberOfMessages ?? 0);
  }

  async onModuleDestroy(): Promise<void> {
    this.client.destroy();
  }
}
