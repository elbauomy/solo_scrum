/** Thrown when the signed-in user's role does not allow an action. */
export class ForbiddenError extends Error {
  constructor() {
    super("Your role does not allow this. Ask an administrator if you need access.");
  }
}
