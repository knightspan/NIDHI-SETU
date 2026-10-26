import { Module } from '@nestjs/common';
import { MasterController } from './master.controller.js';
import { UsersController } from './users.controller.js';

@Module({
  controllers: [UsersController, MasterController],
})
export class AdminModule {}
