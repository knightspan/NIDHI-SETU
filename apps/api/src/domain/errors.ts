/** Errors raised by domain logic; the exception filter maps them to HTTP status codes. */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(what = 'Record') {
    super(`${what} not found`, 404, 'NotFound');
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, code = 'Conflict') {
    super(message, 409, code);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message: string, code = 'Forbidden') {
    super(message, 403, code);
  }
}

export class InvalidInputError extends DomainError {
  constructor(message: string) {
    super(message, 400, 'InvalidInput');
  }
}

/** Maker-checker violation (Section 5): the same person cannot perform two separated duties. */
export class SegregationOfDutiesError extends ForbiddenError {
  constructor(message: string) {
    super(message, 'SegregationOfDuties');
  }
}
