export class AlreadyExistsError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} already exists: ${id}`);
    this.name = 'AlreadyExistsError';
  }
}

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} does not exist: ${id}`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class VaultLockedError extends Error {
  constructor() {
    super('Vault write lock is already held');
    this.name = 'VaultLockedError';
  }
}

export class InvalidStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStateError';
  }
}

export function hasFileCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
