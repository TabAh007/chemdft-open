import { type NextRequest } from "next/server";

import { isOwner } from "../../../../lib/auth/owner.ts";
import { getSession } from "../../../../lib/auth/session.ts";
import { isLocalDevelopment } from "../../../../lib/local-development.ts";
import {
  countFailedReportsInWindow,
  FeedbackTableMissingError,
  listRecentFeedbackReports,
} from "../../../../lib/feedback/db.ts";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  const session = await getSession(request.headers);
  const isDev = isLocalDevelopment(process.env);
  const user = session?.user ?? (isDev ? { id: "dev-owner", email: "tab@chemdft.com", name: "Dev Owner" } : null);
  if (!user || !isOwner(user)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const reports = await listRecentFeedbackReports(100);
    const failedLast7Days = await countFailedReportsInWindow(7 * 24 * 60 * 60 * 1000);

    return Response.json(
      {
        reports,
        failedLast7Days,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof FeedbackTableMissingError) {
      return Response.json(
        {
          reports: [],
          failedLast7Days: 0,
          tableMissing: true,
          notice: "Feedback table has not been created yet in the auth database.",
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    return Response.json({ error: "failed_to_list_feedback", detail: String(error) }, { status: 500 });
  }
}
