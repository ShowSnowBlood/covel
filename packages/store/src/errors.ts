/** Raised when `createSession` is asked to reuse an existing session id. */
export class SessionAlreadyExistsError extends Error {
  readonly code = "session_already_exists";

  constructor(readonly sessionId: string) {
    super(`Session already exists: ${sessionId}`);
    this.name = "SessionAlreadyExistsError";
  }
}

/** Normalize the unique-constraint codes emitted by bundled SQL drivers. */
export function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return (
    code === "23505" ||
    (typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT"))
  );
}
