import { Module } from '@nestjs/common';
import { MasterController } from './master.controller.js';
import { RetentionController } from './retention.controller.js';
import { UsersController } from './users.controller.js';

@Module({
  controllers: [UsersController, MasterController, RetentionController],
})
export class AdminModule {}
