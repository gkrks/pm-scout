"use client";

import { useState } from "react";
import { Send, Loader2, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { generateCoverLetter, generateOutreach, refreshIntel, downloadUrl } from "@/lib/api";

const OUTREACH_MODES = [
  { value: "cover_letter", label: "Cover Letter" },
  { value: "linkedin_referral_peer", label: "LinkedIn Peer" },
  { value: "linkedin_referral_open_to_connect", label: "LinkedIn Open" },
  { value: "linkedin_hiring_manager", label: "Hiring Manager" },
] as const;

interface OutreachPanelProps {
  jobId: string;
  token: string;
  selectedBulletTexts: string[];
}

export function OutreachPanel({ jobId, token, selectedBulletTexts }: OutreachPanelProps) {
  const [mode, setMode] = useState<string>("cover_letter");
  const [result, setResult] = useState<{ text: string; hook?: string; wordCount?: number } | null>(null);
  const [editedText, setEditedText] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshingIntel, setRefreshingIntel] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    try {
      if (mode === "cover_letter") {
        const res = await generateCoverLetter(jobId, token, selectedBulletTexts) as any;
        setResult({ text: res.letter, wordCount: res.wordCount });
        setEditedText(res.letter);
      } else {
        const res = await generateOutreach(jobId, token, mode) as any;
        if (res.skip) {
          toast.info(res.reason || "Hook not specific enough to generate outreach.");
          return;
        }
        setResult({ text: res.text, hook: res.hook, wordCount: res.wordCount });
        setEditedText(res.text);
      }
      toast.success("Generated successfully");
    } catch (err: any) {
      toast.error(err.message || "Generation failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleRefreshIntel() {
    setRefreshingIntel(true);
    try {
      await refreshIntel(jobId, token);
      toast.success("Company intel refreshed");
    } catch (err: any) {
      toast.error(err.message || "Intel refresh failed");
    } finally {
      setRefreshingIntel(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Outreach</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefreshIntel}
          disabled={refreshingIntel}
          className="h-7 text-xs"
        >
          <RefreshCw className={`mr-1 h-3 w-3 ${refreshingIntel ? "animate-spin" : ""}`} />
          Refresh Intel
        </Button>
      </div>

      <Tabs value={mode} onValueChange={setMode}>
        <TabsList className="w-full">
          {OUTREACH_MODES.map((m) => (
            <TabsTrigger key={m.value} value={m.value} className="text-xs flex-1">
              {m.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Button
        onClick={handleGenerate}
        disabled={loading}
        variant="outline"
        className="w-full"
        size="sm"
      >
        {loading ? (
          <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Generating...</>
        ) : (
          <><Send className="mr-1.5 h-3.5 w-3.5" />Generate {OUTREACH_MODES.find((m) => m.value === mode)?.label}</>
        )}
      </Button>

      {result && (
        <div className="space-y-2">
          {result.hook && (
            <div className="rounded-md bg-muted p-2">
              <p className="text-xs text-muted-foreground mb-0.5">Hook:</p>
              <p className="text-sm">{result.hook}</p>
            </div>
          )}
          <Textarea
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
            className="min-h-[200px] text-sm"
          />
          {result.wordCount && (
            <p className="text-xs text-muted-foreground">{result.wordCount} words</p>
          )}
          {mode === "cover_letter" && (
            <a
              href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3847"}/fit/${jobId}/download/cover-letter?token=${token}`}
            >
              <Button variant="outline" size="sm" className="w-full">
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download Cover Letter DOCX
              </Button>
            </a>
          )}
        </div>
      )}
    </div>
  );
}
