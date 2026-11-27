import { Injectable } from '@nestjs/common';

@Injectable()
export class StructuredLogger {
  log(event: string, fields: Record<string, unknown> = {}): void {
    process.stdout.write(
      `${JSON.stringify({ level: 'info', event, timestamp: new Date().toISOString(), ...fields })}\n`,
    );
  }
  error(
    event: string,
    error: unknown,
    fields: Record<string, unknown> = {},
  ): void {
    const message = error instanceof Error ? error.message : 'unknown_error';
    process.stderr.write(
      `${JSON.stringify({ level: 'error', event, timestamp: new Date().toISOString(), error: message, ...fields })}\n`,
    );
  }
}
