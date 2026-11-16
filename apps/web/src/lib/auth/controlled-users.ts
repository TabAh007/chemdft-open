import { isLocalEnvironment, type Environment } from "./environment.ts";
import { getAuth, type createAuth } from "./server.ts";

export class ControlledUserError extends Error {}

/**
 * Create a real, independent account without enabling public signup. This is the ONLY account-creation
 * path while signup is closed, and it exists only as a server-side function (a CLI script and test
 * helper call it); there is no HTTP route for it. It refuses to run outside an explicitly local/test
 * environment.
 */
export async function createControlledUser(
  input: { email: string; name: string; password: string },
  environment: Environment = process.env,
  bundle?: Awaited<ReturnType<typeof createAuth>>,
): Promise<{ id: string; email: string }> {
  if (!isLocalEnvironment(environment)) {
    throw new ControlledUserError("Controlled test accounts can only be created in an explicitly local environment.");
  }
  if (input.password.length < 12) throw new ControlledUserError("Password must be at least 12 characters.");
  const email = input.email.trim().toLowerCase();
  const { auth } = bundle ?? (await getAuth());
  const context = await auth.$context;
  if (await context.internalAdapter.findUserByEmail(email, { includeAccounts: false })) throw new ControlledUserError("An account with this email already exists.");
  const user = await context.internalAdapter.createUser({ email, name: input.name, emailVerified: true }, { method: "admin" });
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await context.password.hash(input.password),
  });
  return { id: user.id, email };
}
