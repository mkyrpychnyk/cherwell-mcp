/** Error from the Cherwell REST API — HTTP-level or in-band (hasError in a 200 response). */
export class CherwellApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly errorCode?: string,
    public readonly url?: string
  ) {
    super(message);
    this.name = "CherwellApiError";
  }
}

export class CherwellAuthError extends CherwellApiError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "CherwellAuthError";
  }
}
