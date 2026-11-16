import { getAuth } from "./server.ts";

export type BetaAccountLimits = {
  jobsPerDay: number;
  jobsPerMonth: number;
  concurrentJobs: number;
  storageMb: number;
  uploadMb: number;
  aiRunsPerDay: number;
  aiEnabled: boolean;
};

/**
 * Global beta limits configured on the backend API via environment / SSM (ADR-045).
 * Read-only in the owner console: individual per-user overrides are not supported
 * by the backend and are not editable.
 */
export const DEFAULT_BETA_LIMITS: BetaAccountLimits = {
  jobsPerDay: 5,
  jobsPerMonth: 40,
  concurrentJobs: 2,
  storageMb: 200,
  uploadMb: 25,
  aiRunsPerDay: 20,
  aiEnabled: false,
};

export type AccountRole = "Owner" | "Invited Researcher" | "Beta Tester";

export type OwnerAccountSummary = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  isOwner: boolean;
  signupSource: string | null;
  role: AccountRole;
  disabled: boolean;
  limits: BetaAccountLimits | "unlimited";
  limitsDescription: string;
};

type StoredMeta = {
  disabled?: boolean | undefined;
};

export function isOwner(user: { email: string; signupSource?: string | null | undefined }): boolean {
  const configured = (process.env.CHEMDFT_OWNER_EMAIL ?? process.env.CHEMDFT_BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length > 0) {
    return configured.includes(user.email.toLowerCase());
  }
  // Default rule: non-self-signup accounts (pre-existing owner/invited) or accounts with owner/admin in email
  return user.signupSource !== "self";
}

function metaKey(userId: string): string {
  return `chemdft:meta:${userId}`;
}

type BetterAuthAdapter = {
  findOne: (q: { model: string; where: { field: string; value: unknown }[] }) => Promise<unknown>;
  findMany: (q: { model: string; where?: { field: string; value: unknown }[] }) => Promise<unknown[]>;
  create: (q: { model: string; data: Record<string, unknown> }) => Promise<unknown>;
  update: (q: { model: string; where: { field: string; value: unknown }[]; update: Record<string, unknown> }) => Promise<unknown>;
  delete: (q: { model: string; where: { field: string; value: unknown }[] }) => Promise<unknown>;
};

export async function getAccountMeta(adapter: BetterAuthAdapter, userId: string): Promise<StoredMeta> {
  try {
    const row = (await adapter.findOne({
      model: "verification",
      where: [{ field: "identifier", value: metaKey(userId) }],
    })) as { value?: string } | null;
    if (!row?.value) return {};
    return JSON.parse(row.value) as StoredMeta;
  } catch {
    return {};
  }
}

export async function setAccountMeta(
  adapter: BetterAuthAdapter,
  userId: string,
  metaUpdate: StoredMeta,
): Promise<StoredMeta> {
  const existing = await getAccountMeta(adapter, userId);
  const updated: StoredMeta = {
    ...existing,
    disabled: metaUpdate.disabled !== undefined ? metaUpdate.disabled : existing.disabled,
  };
  const identifier = metaKey(userId);
  const value = JSON.stringify(updated);
  const where = [{ field: "identifier", value: identifier }];
  const existingRow = await adapter.findOne({ model: "verification", where });
  if (existingRow) {
    await adapter.update({ model: "verification", where, update: { value, updatedAt: new Date() } });
  } else {
    await adapter.create({
      model: "verification",
      data: {
        identifier,
        value,
        expiresAt: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000), // long-lived
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }
  return updated;
}

export async function isUserDisabled(adapter: BetterAuthAdapter, userId: string): Promise<boolean> {
  const meta = await getAccountMeta(adapter, userId);
  return Boolean(meta.disabled);
}

export async function getEffectiveLimits(
  _adapter: BetterAuthAdapter,
  _userId: string,
  ownerOrInvited: boolean,
): Promise<BetaAccountLimits | "unlimited"> {
  if (ownerOrInvited) return "unlimited";
  return { ...DEFAULT_BETA_LIMITS };
}

/**
 * Counts non-owner self-signup accounts that count against the beta cap.
 * Pre-existing accounts that are not owners (invited/test accounts with no signupSource or signupSource !== 'self')
 * and owner accounts do NOT count against the cap.
 */
export async function countNonOwnerAccounts(adapter: BetterAuthAdapter): Promise<number> {
  const users = (await adapter.findMany({ model: "user" })) as Array<{
    id: string;
    email: string;
    signupSource?: string | null;
  }>;
  return users.filter((u) => !isOwner(u) && u.signupSource === "self").length;
}

export async function listAccountsForOwner(): Promise<OwnerAccountSummary[]> {
  const { auth } = await getAuth();
  const context = await auth.$context;
  const adapter = context.adapter as unknown as BetterAuthAdapter;
  const users = (await adapter.findMany({ model: "user" })) as Array<{
    id: string;
    email: string;
    name?: string | null;
    createdAt?: Date | string | null;
    signupSource?: string | null;
  }>;

  const summaries: OwnerAccountSummary[] = [];
  for (const user of users) {
    const ownerAccount = isOwner({ email: user.email, signupSource: user.signupSource });
    const isSelfSignup = user.signupSource === "self";
    const meta = await getAccountMeta(adapter, user.id);

    let role: AccountRole;
    let limits: BetaAccountLimits | "unlimited";
    let limitsDescription: string;

    if (ownerAccount) {
      role = "Owner";
      limits = "unlimited";
      limitsDescription = "Unlimited (Owner account)";
    } else if (!isSelfSignup) {
      role = "Invited Researcher";
      limits = "unlimited";
      limitsDescription = "Unlimited (Pre-existing / invited account, ADR-045)";
    } else {
      role = "Beta Tester";
      limits = { ...DEFAULT_BETA_LIMITS };
      limitsDescription = "Global beta limits: 5 jobs/day · 40 jobs/mo · 2 concurrent · 200MB storage · 25MB upload · AI Off";
    }

    summaries.push({
      id: user.id,
      email: user.email,
      name: user.name || user.email.split("@")[0] || "",
      createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : String(user.createdAt ?? new Date().toISOString()),
      isOwner: ownerAccount,
      signupSource: user.signupSource ?? null,
      role,
      disabled: Boolean(meta.disabled),
      limits,
      limitsDescription,
    });
  }
  // Sort owners first, then newest accounts first
  return summaries.sort((a, b) => {
    if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}
