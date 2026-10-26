import { Logger } from '@nestjs/common';
import { maskPhone } from './mail.service.js';

/** SMS channel (Section 7 · cap 7). A DLT-registered gateway would implement this interface. */
export interface SmsAdapter {
  send(phone: string, message: string): Promise<void>;
}

export const SMS_ADAPTER = Symbol('SMS_ADAPTER');

/** Logs instead of sending; the number is masked (PII). */
export class StubSmsAdapter implements SmsAdapter {
  private readonly logger = new Logger('SmsStub');
  readonly sent: { phone: string; message: string }[] = [];

  send(phone: string, message: string): Promise<void> {
    this.sent.push({ phone: maskPhone(phone), message });
    this.logger.log(`SMS to ${maskPhone(phone)}: ${message.slice(0, 120)}`);
    return Promise.resolve();
  }
}
