/**
 * Additive authentication-database migration for self-service signup (ADR-045): prints the SQL by default,
 * applies it only with `--apply`. Needs the same environment as the site (CHEMDFT_AUTH_DATABASE_URL, BETTER_AUTH_*).
 * It only adds nullable columns to `user` and creates `rateLimit`; it never drops or rewrites anything.
 */
import { authMigrationPlan } from "../src/lib/auth/server.ts";

const apply = process.argv.includes("--apply");
const plan = await authMigrationPlan(process.env, apply);
console.log(plan.sql || "-- nothing to do");
console.log(`\n-- tables to create: ${plan.tables.join(", ") || "none"}; columns to add: ${plan.columns.join("; ") || "none"}`);
console.log(apply ? "-- APPLIED" : "-- dry run (pass --apply to run it)");
process.exit(0);
