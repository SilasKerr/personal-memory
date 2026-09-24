import { ZodError } from 'zod';
import {
  AlreadyExistsError, ConflictError, ExternalChangePendingError, IntegrityError, InvalidStateError, NotFoundError, VaultLockedError,
} from '../repositories/errors.js';

export type MemoryErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'ALREADY_EXISTS' | 'CONFLICT' | 'LOCKED' | 'INVALID_STATE' | 'INTEGRITY' | 'VAULT_ERROR';

export function mapError(error: unknown): { code: MemoryErrorCode; message: string } {
  if (error instanceof ZodError) return {
    code: 'INVALID_INPUT',
    message: error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; '),
  };
  if (error instanceof NotFoundError) return { code: 'NOT_FOUND', message: error.message };
  if (error instanceof AlreadyExistsError) return { code: 'ALREADY_EXISTS', message: error.message };
  if (error instanceof ConflictError) return { code: 'CONFLICT', message: error.message };
  if (error instanceof ExternalChangePendingError) return { code: 'CONFLICT', message: error.message };
  if (error instanceof IntegrityError) return { code: 'INTEGRITY', message: error.message };
  if (error instanceof VaultLockedError) return { code: 'LOCKED', message: error.message };
  if (error instanceof InvalidStateError) return { code: 'INVALID_STATE', message: error.message };
  return { code: 'VAULT_ERROR', message: 'Vault operation failed; inspect the local server log' };
}
