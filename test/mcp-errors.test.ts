import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { mapError } from '../src/mcp/errors.js';
import { AlreadyExistsError, ConflictError, InvalidStateError, NotFoundError, VaultLockedError } from '../src/repositories/errors.js';

test('MCP error mapper exposes stable codes without stack traces', () => {
  const cases: Array<[unknown, string]> = [
    [z.string().safeParse({}).error, 'INVALID_INPUT'],
    [new NotFoundError('Project', 'missing'), 'NOT_FOUND'],
    [new AlreadyExistsError('Project', 'existing'), 'ALREADY_EXISTS'],
    [new ConflictError('Revision changed'), 'CONFLICT'],
    [new VaultLockedError(), 'LOCKED'],
    [new InvalidStateError('Already applied'), 'INVALID_STATE'],
    [new Error('secret internal path'), 'VAULT_ERROR'],
  ];
  for (const [error, code] of cases) {
    const mapped = mapError(error);
    assert.equal(mapped.code, code);
    assert.doesNotMatch(mapped.message, /\bat .*:\d+:\d+/);
  }
  assert.doesNotMatch(mapError(new Error('secret internal path')).message, /secret internal path/);
});
