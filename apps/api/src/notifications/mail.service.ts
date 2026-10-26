import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** SMTP mailer (Mailpit in development). */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get enabled(): boolean {
    return this.config.EMAIL_ENABLED;
  }

  private transport(): Transporter {
    this.transporter ??= nodemailer.createTransport({
      host: this.config.SMTP_HOST,
      port: this.config.SMTP_PORT,
      secure: false,
      ignoreTLS: this.config.NODE_ENV !== 'production',
    });
    return this.transporter;
  }

  async send(m: MailMessage): Promise<void> {
    await this.transport().sendMail({
      from: this.config.SMTP_FROM,
      to: m.to,
      subject: m.subject,
      text: `${m.text}\n\n—\nNidhiSetu · AICTE security deposit portal\n${this.config.WEB_ORIGIN}\nThis is an automated message.`,
    });
    this.logger.debug(`mail sent to ${maskEmail(m.to)}: ${m.subject}`);
  }
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskPhone(phone: string): string {
  return phone.replace(/\d(?=\d{2})/g, '•');
}
