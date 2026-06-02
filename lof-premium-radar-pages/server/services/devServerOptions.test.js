import { describe, expect, it } from 'vitest';
import { resolveDevHmrPort } from './devServerOptions.js';

describe('devServerOptions', () => {
  it('derives a unique HMR port from the app port unless explicitly configured', () => {
    expect(resolveDevHmrPort({ port: 4283, env: {} })).toBe(14283);
    expect(resolveDevHmrPort({ port: 4283, env: { HMR_PORT: '15555' } })).toBe(15555);
  });
});
