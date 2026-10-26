import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuditModule } from '../audit/audit.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './jwt.strategy.js';
import { TotpService } from './totp.service.js';

@Module({
  imports: [PassportModule, JwtModule.register({}), AuditModule],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, TotpService],
  exports: [AuthService, TotpService],
})
export class AuthModule {}
