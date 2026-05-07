import { FitClient } from "@/components/fit/fit-client";
import { fetchFitListing } from "@/lib/api";

export default async function FitPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { jobId } = await params;
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="mx-auto max-w-screen-lg px-4 py-12 sm:px-6 text-center">
        <h1 className="text-2xl font-bold text-destructive">Access Denied</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Missing token. Use the link from your email digest.
        </p>
      </div>
    );
  }

  let listing;
  try {
    listing = await fetchFitListing(jobId, token);
  } catch (err: any) {
    const status = err?.status || 500;
    const message = err?.message || "Unknown error";

    if (status === 401) {
      return (
        <div className="mx-auto max-w-screen-lg px-4 py-12 sm:px-6 text-center">
          <h1 className="text-2xl font-bold text-destructive">Invalid Token</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The token is invalid or expired. Use the link from your email digest.
          </p>
        </div>
      );
    }

    if (status === 404) {
      return (
        <div className="mx-auto max-w-screen-lg px-4 py-12 sm:px-6 text-center">
          <h1 className="text-2xl font-bold">Job Not Found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This listing may have been removed.
          </p>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-screen-lg px-4 py-12 sm:px-6 text-center">
        <h1 className="text-2xl font-bold text-destructive">Error</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-6 sm:px-6">
      <FitClient listing={listing} token={token} />
    </div>
  );
}
