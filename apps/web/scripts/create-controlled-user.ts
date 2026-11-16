/**
 * Create a controlled (non-public) account in a LOCAL/TEST environment while signup is closed.
 *
 *   CHEMDFT_AUTH_MODE=jwt BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://127.0.0.1:3000 \
 *   CHEMDFT_NEW_USER_PASSWORD=… pnpm auth:create-user --email alice@example.test --name "Alice"
 *
 * Runs on Node's built-in TypeScript support (Node >= 22.18 / 24), so no loader or bundler is needed;
 * the modules in its import chain therefore use explicit `.ts` import extensions.
 *
 * The password is read from CHEMDFT_NEW_USER_PASSWORD (never a command-line argument, so it stays out of
 * shell history). The script refuses to run in a hosted environment.
 */
import { createControlledUser } from "../src/lib/auth/controlled-users.ts";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const email = argument("email");
const name = argument("name") ?? email?.split("@")[0];
const password = process.env.CHEMDFT_NEW_USER_PASSWORD;
if (!email || !name || !password) {
  console.error("Usage: CHEMDFT_NEW_USER_PASSWORD=… auth:create-user --email <email> [--name <name>]");
  process.exit(2);
}
try {
  const user = await createControlledUser({ email, name, password });
  console.log(`Created controlled account ${user.email} (${user.id}).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
