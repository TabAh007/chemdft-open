import { type NextRequest } from "next/server";

import { countNonOwnerAccounts, isOwner, listAccountsForOwner, setAccountMeta } from "../../../../lib/auth/owner";
import { getAuth } from "../../../../lib/auth/server";
import { getSession } from "../../../../lib/auth/session";
import { deleteFeedbackReportsForUser } from "../../../../lib/feedback/db";

type BetterAuthAdapter = {
  delete: (q: { model: string; where: { field: string; value: unknown }[] }) => Promise<unknown>;
  findOne: (q: { model: string; where: { field: string; value: unknown }[] }) => Promise<unknown>;
  findMany: (q: { model: string; where?: { field: string; value: unknown }[] }) => Promise<unknown[]>;
  create: (q: { model: string; data: Record<string, unknown> }) => Promise<unknown>;
  update: (q: { model: string; where: { field: string; value: unknown }[]; update: Record<string, unknown> }) => Promise<unknown>;
};

export async function GET(request: NextRequest): Promise<Response> {
  const session = await getSession(request.headers);
  if (!session?.user || !isOwner(session.user)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { auth, config } = await getAuth();
    const context = await auth.$context;
    const adapter = context.adapter as unknown as BetterAuthAdapter;
    const accounts = await listAccountsForOwner();
    const countedNonOwnerAccounts = await countNonOwnerAccounts(adapter);
    return Response.json(
      {
        accounts,
        betaUserCap: config.betaUserCap,
        countedNonOwnerAccounts,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json({ error: "failed_to_list_accounts", detail: String(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const session = await getSession(request.headers);
  if (!session?.user || !isOwner(session.user)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as {
      userId?: string;
      disabled?: boolean;
    };

    const { userId, disabled } = body;
    if (typeof userId !== "string" || !userId.trim()) {
      return Response.json({ error: "invalid_user_id" }, { status: 400 });
    }

    if (userId === session.user.id && disabled === true) {
      return Response.json({ error: "cannot_disable_self" }, { status: 400 });
    }

    const { auth } = await getAuth();
    const context = await auth.$context;
    const adapter = context.adapter as unknown as BetterAuthAdapter;

    const updated = await setAccountMeta(adapter, userId, { disabled });

    if (disabled === true) {
      await adapter.delete({ model: "session", where: [{ field: "userId", value: userId }] });
      try {
        await deleteFeedbackReportsForUser(userId);
      } catch {
        // Lazy-safe: do not fail account disabling if feedback table does not exist
      }
    }

    return Response.json({ ok: true, meta: updated }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: "failed_to_update_account", detail: String(error) }, { status: 500 });
  }
}

