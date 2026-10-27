import { randomUUID } from 'node:crypto';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import { PERMISSIONS, ROLES, type Permission, type Role } from '@nidhisetu/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTHENTICATED_ONLY, IS_PUBLIC, PERMISSIONS_KEY } from '../src/auth/decorators.js';
import { Client, createFixture, createTestApp, type Fixture } from './helpers.js';

interface Route {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  access: 'public' | 'authenticated' | Permission[] | 'undeclared';
}

const METHODS: Partial<Record<RequestMethod, Route['method']>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

const join = (...parts: (string | undefined)[]) =>
  `/${parts
    .flatMap((p) => (p ?? '').split('/'))
    .filter(Boolean)
    .join('/')}`;

/** Every HTTP route with the access rule its handler declares. */
function discoverRoutes(app: INestApplication): Route[] {
  const routes: Route[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const ctrl = wrapper.metatype as (new (...a: never[]) => unknown) | null;
      if (!ctrl) continue;
      const base = Reflect.getMetadata(PATH_METADATA, ctrl) as string | undefined;
      const proto = ctrl.prototype as object;
      for (const name of Object.getOwnPropertyNames(proto)) {
        // Read descriptors, not properties: getters on controllers must not run here.
        const handler = Object.getOwnPropertyDescriptor(proto, name)?.value as unknown;
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        const verb = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (path === undefined || verb === undefined) continue;
        const method = METHODS[verb];
        if (!method) continue;
        const meta = (key: string) =>
          (Reflect.getMetadata(key, handler) as unknown) ??
          (Reflect.getMetadata(key, ctrl) as unknown);
        const perms = meta(PERMISSIONS_KEY) as Permission[] | undefined;
        routes.push({
          method,
          path: join('api', base, path),
          access: meta(IS_PUBLIC)
            ? 'public'
            : perms?.length
              ? perms
              : meta(AUTHENTICATED_ONLY)
                ? 'authenticated'
                : 'undeclared',
        });
      }
    }
  }
  return routes;
}

const allowed = (role: Role, perms: Permission[]) =>
  perms.some((p) => (PERMISSIONS[p] as readonly Role[]).includes(role));

describe('RBAC matrix: every route, every role', () => {
  let app: INestApplication;
  let fx: Fixture;
  let routes: Route[];
  const clients = new Map<Role, Client>();

  beforeAll(async () => {
    app = await createTestApp();
    fx = await createFixture(app);
    for (const role of ROLES) clients.set(role, await Client.login(app, fx.users[role]));
    routes = discoverRoutes(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('discovers the API surface', () => {
    expect(routes.length).toBeGreaterThan(60);
  });

  it('declares an access rule on every route (default deny is never relied on silently)', () => {
    expect(
      routes.filter((r) => r.access === 'undeclared').map((r) => `${r.method} ${r.path}`),
    ).toEqual([]);
  });

  it('refuses anonymous callers on every non-public route', async () => {
    const anon = await Client.anonymous(app);
    for (const r of routes.filter((x) => x.access !== 'public')) {
      const url = r.path.replace(/:[A-Za-z]+/g, randomUUID());
      const res = r.method === 'get' ? await anon.get(url) : await anon[r.method](url, {});
      expect([`${r.method} ${r.path}`, res.status]).toEqual([`${r.method} ${r.path}`, 401]);
    }
  });

  it('returns 403 exactly for the roles the permission table excludes', async () => {
    const mismatches: string[] = [];
    for (const r of routes) {
      if (!Array.isArray(r.access)) continue;
      const url = r.path.replace(/:[A-Za-z]+/g, randomUUID());
      for (const role of ROLES) {
        const c = clients.get(role)!;
        // Empty bodies / unknown ids: allowed roles get 2xx/400/404/409, never 403.
        const res = r.method === 'get' ? await c.get(url) : await c[r.method](url, {});
        const expectForbidden = !allowed(role, r.access);
        if (expectForbidden !== (res.status === 403))
          mismatches.push(`${role} ${r.method.toUpperCase()} ${r.path} → ${res.status}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
