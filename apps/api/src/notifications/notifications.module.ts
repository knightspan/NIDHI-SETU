import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { SMS_ADAPTER, StubSmsAdapter } from './sms.adapter.js';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    MailService,
    NotificationsService,
    { provide: SMS_ADAPTER, useClass: StubSmsAdapter },
  ],
  exports: [NotificationsService, MailService, SMS_ADAPTER],
})
export class NotificationsModule {}
