"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { submitUrl } from "@/lib/api";

const DASHBOARD_TOKEN = process.env.NEXT_PUBLIC_DASHBOARD_TOKEN || "";

export default function SubmitUrlPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    setLoading(true);
    try {
      const result = await submitUrl(trimmed, DASHBOARD_TOKEN);
      if (result.existing) {
        toast.info("Job already exists — redirecting...");
      } else {
        toast.success("Job analyzed successfully!");
      }
      router.push(`/fit/${result.jobId}?token=${result.token}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to process URL");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-screen-sm px-4 py-12 sm:px-6">
      <Card className="p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Check Fit for Any Job</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Paste a job posting URL to score your resume against the qualifications
            and generate a tailored resume.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="job-url"
              className="block text-sm font-medium mb-1.5"
            >
              Job Posting URL
            </label>
            <div className="relative">
              <LinkIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="job-url"
                type="url"
                placeholder="https://boards.greenhouse.io/company/jobs/12345"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                className="pl-10"
                disabled={loading}
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading || !url.trim()}
            className="w-full bg-indigo-500 hover:bg-indigo-600 text-white"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              "Analyze Job Posting"
            )}
          </Button>
        </form>

        <p className="mt-6 text-xs text-muted-foreground text-center">
          Supports Greenhouse, Lever, Ashby, Workday, SmartRecruiters, and most
          career pages.
        </p>
      </Card>
    </div>
  );
}
