import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { from, switchMap, type Observable } from 'rxjs';
import { ClockService } from './clock.service.js';

/** Makes sure every request sees the latest demo-clock offset. */
@Injectable()
export class ClockSyncInterceptor implements NestInterceptor {
  constructor(private readonly clock: ClockService) {}

  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(this.clock.sync()).pipe(switchMap(() => next.handle()));
  }
}
