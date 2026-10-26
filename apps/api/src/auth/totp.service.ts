import { Inject, Injectable } from '@nestjs/common';
import { generate, generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { openString, sealString } from '../common/crypto.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

const ISSUER = 'NidhiSetu (AICTE)';

/** TOTP (RFC 6238) for MFA. Secrets are stored AES-GCM encrypted with MFA_ENCRYPTION_KEY. */
@Injectable()
export class TotpService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  newSecret(): string {
    return generateSecret();
  }

  encrypt(secret: string): string {
    return sealString(secret, this.config.MFA_ENCRYPTION_KEY);
  }

  decrypt(sealed: string): string {
    return openString(sealed, this.config.MFA_ENCRYPTION_KEY);
  }

  otpauthUrl(email: string, secret: string): string {
    return generateURI({ issuer: ISSUER, label: email, secret });
  }

  async qrDataUrl(otpauthUrl: string): Promise<string> {
    return QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
  }

  /** Accepts the current code and one step either side (clock drift). */
  async check(secret: string, code: string): Promise<boolean> {
    const result = await verify({ secret, token: code, epochTolerance: 30 });
    return result.valid;
  }

  /** Used by tests and the demo helper only. */
  async codeFor(secret: string): Promise<string> {
    return generate({ secret });
  }
}
