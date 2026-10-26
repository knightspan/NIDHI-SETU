import type { Role } from '@nidhisetu/shared';
import type { Principal } from '../domain/scope.js';

/** Who performed an action: a user, or the system (jobs, automatic follow-ups). */
export interface Actor {
  id: string | null;
  role: Role | 'SYSTEM';
}

export const SYSTEM_ACTOR: Actor = { id: null, role: 'SYSTEM' };

export function actorOf(p: Principal): Actor {
  return { id: p.id, role: p.role };
}
