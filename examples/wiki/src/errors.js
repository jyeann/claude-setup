// Errors that map to JSON error responses.
export class WikiError extends Error {
  constructor(status, code, message, params = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.params = params;
  }
}

export const storageError = () => new WikiError(503, 'storage_error', 'The vault could not be written. Try again.');

// Thrown by vault.js when the filesystem refuses a write.
export class StorageError extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
  }
}

// Thrown by vault.js when a create or move would overwrite something.
export class ExistsError extends Error {}
