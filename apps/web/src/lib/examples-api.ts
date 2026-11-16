import type {
  ExampleCopyOutput,
  ExampleDetail,
  ExampleSummary,
} from "@chemdft/schemas";

export async function publicExamples<
  T extends ExampleSummary[] | ExampleDetail,
>(slug?: string): Promise<T | null> {
  const url = new URL(
    `/v1/examples${slug ? `/${encodeURIComponent(slug)}` : ""}`,
    process.env.CHEMDFT_API_BASE_URL ?? "http://127.0.0.1:8000",
  );
  const response = await fetch(url, { cache: "no-store", redirect: "error" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Published examples could not be loaded.");
  return response.json() as Promise<T>;
}

export async function copyExample(slug: string): Promise<ExampleCopyOutput> {
  const response = await fetch(
    `/api/chemdft/v1/examples/${encodeURIComponent(slug)}/copy`,
    { method: "POST", credentials: "same-origin" },
  );
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Sign in before copying this example."
        : "The example could not be copied. Retry or return to the catalogue.",
    );
  return response.json() as Promise<ExampleCopyOutput>;
}
