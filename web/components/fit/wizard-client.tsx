"use client";

import { useReducer, useCallback, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  generateResume as apiGenerateResume,
  downloadUrl,
  type FitListingData,
} from "@/lib/api";
import type { ScoreResponse, LockedBullet } from "@/lib/types";
import {
  wizardReducer,
  initWizardState,
  buildSelectionsFromLocked,
  flatLockedBullets,
} from "@/lib/wizard-state";

import { WizardStepper } from "./wizard-stepper";
import { AllocationTracker } from "./allocation-tracker";
import { JDAnalysisStep } from "./jd-analysis-step";
import { SummaryPicker } from "./summary-picker";
import { RequirementStep } from "./requirement-step";
import { FillRemainingStep } from "./fill-remaining-step";
import { SkillsEditor } from "./skills-editor";
import { GeneratePanel } from "./generate-panel";
import { OutreachPanel } from "./outreach-panel";

interface WizardClientProps {
  scoreData: ScoreResponse;
  listing: FitListingData;
  token: string;
}

/** Normalize backend skill shapes for the rules validator */
function normalizeSkillsForRules(raw: unknown[]): { category: string; items: string[] }[] {
  return raw.map((s: any) => ({
    category: s.category || s.name || "Other",
    items: Array.isArray(s.items)
      ? s.items
      : typeof s.list === "string"
        ? s.list.split(",").map((x: string) => x.trim()).filter(Boolean)
        : [],
  }));
}

export function WizardClient({ scoreData, listing, token }: WizardClientProps) {
  const jobId = listing.jobId;
  const [state, dispatch] = useReducer(wizardReducer, scoreData, initWizardState);

  // ── Generate mutation ──────────────────────────────────────────
  const selections = useMemo(
    () => buildSelectionsFromLocked(state.lockedBullets),
    [state.lockedBullets]
  );

  const summaryText = useMemo(() => {
    if (state.summaryChoice === "custom") return state.customSummaryText;
    const idx = state.summaryChoice as number;
    // Use edited version if available, otherwise original
    return state.summaryCandidateEdits.get(idx)
      ?? scoreData.summary_candidates?.[idx]?.text;
  }, [state.summaryChoice, state.customSummaryText, state.summaryCandidateEdits, scoreData.summary_candidates]);

  const generateMutation = useMutation({
    mutationFn: () =>
      apiGenerateResume(jobId, token, {
        selections,
        summaryHints: summaryText,
        email: listing.emails[0],
        skillEdits:
          Object.keys(state.skillEdits).length > 0 ? state.skillEdits : undefined,
        skillDeletions:
          state.skillDeletions.size > 0 ? Array.from(state.skillDeletions) : undefined,
        newSkillSections:
          state.newSkillSections.length > 0 ? state.newSkillSections : undefined,
      }),
    onSuccess: (data) => {
      dispatch({
        type: "SET_GENERATED",
        basename: data.basename,
        warning: data.summaryWarning || null,
      });
      toast.success("Resume generated");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Generation failed");
    },
  });

  // ── Selected bullet texts (for outreach) ───────────────────────
  const selectedBulletTexts = useMemo(() => {
    const texts: string[] = [];
    for (const lb of flatLockedBullets(state.lockedBullets)) {
      if (lb.isTraitSkip) continue;
      texts.push(lb.rewrittenText || lb.originalText);
    }
    return texts;
  }, [state.lockedBullets]);

  // ── Callbacks ──────────────────────────────────────────────────
  const handleLockBullet = useCallback(
    (qualId: string, bullet: LockedBullet) => {
      dispatch({ type: "LOCK_BULLET", qualId, bullet });
    },
    []
  );

  // Compute locked bullet IDs for the match-requirement query
  const lockedBulletIds = useMemo(() => {
    const ids: string[] = [];
    for (const lb of flatLockedBullets(state.lockedBullets)) {
      if (!lb.isTraitSkip && lb.bulletId) ids.push(lb.bulletId);
    }
    return ids;
  }, [state.lockedBullets]);

  const showAllocationSidebar =
    state.currentStep === "requirement" || state.currentStep === "fill_remaining";

  return (
    <div className="flex gap-6">
      {/* Left sidebar — stepper */}
      <div className="w-48 shrink-0 hidden lg:block">
        <div className="sticky top-24">
          <WizardStepper
            currentStep={state.currentStep}
            reqIndex={state.reqIndex}
            totalReqs={state.totalReqs}
            completedSteps={state.completedSteps}
            onGoToStep={(step) => dispatch({ type: "GOTO_STEP", step })}
          />
        </div>
      </div>

      {/* Center — step content */}
      <div className="flex-1 min-w-0">
        {state.currentStep === "jd_analysis" && (
          <JDAnalysisStep
            listing={listing}
            preResolved={scoreData.pre_resolved}
            onNext={() => dispatch({ type: "NEXT_STEP" })}
          />
        )}

        {state.currentStep === "summary" && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold tracking-tight">Professional Summary</h2>
            {scoreData.summary_candidates && scoreData.summary_candidates.length > 0 ? (
              <SummaryPicker
                candidates={scoreData.summary_candidates.map((c, i) => ({
                  ...c,
                  text: state.summaryCandidateEdits.get(i) ?? c.text,
                }))}
                recommended={scoreData.summary_recommended ?? 0}
                jdAnalysis={scoreData.summary_jd_analysis}
                selected={state.summaryChoice}
                customText={state.customSummaryText}
                onSelect={(choice) =>
                  dispatch({
                    type: "LOCK_SUMMARY",
                    choice,
                    customText:
                      choice === "custom" ? state.customSummaryText : undefined,
                  })
                }
                onCustomChange={(text) =>
                  dispatch({
                    type: "LOCK_SUMMARY",
                    choice: "custom",
                    customText: text,
                  })
                }
                onEditCandidate={(index, text) =>
                  dispatch({ type: "EDIT_SUMMARY_CANDIDATE", index, text })
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                No summary candidates generated.
              </p>
            )}
            <div className="flex justify-end pt-2">
              <button
                onClick={() => dispatch({ type: "NEXT_STEP" })}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Continue to Requirements
              </button>
            </div>
          </div>
        )}

        {state.currentStep === "requirement" && (
          <RequirementStep
            qualification={scoreData.ranked_candidates[state.reqIndex]}
            reqIndex={state.reqIndex}
            totalReqs={state.totalReqs}
            lockedBulletsForQual={state.lockedBullets.get(
              scoreData.ranked_candidates[state.reqIndex]?.qualification.id
            )}
            lockedBullets={state.lockedBullets}
            allocation={state.allocation}
            lockedBulletIds={lockedBulletIds}
            jobId={jobId}
            token={token}
            responsibilities={listing.responsibilities}
            onLock={(bullet) =>
              handleLockBullet(
                scoreData.ranked_candidates[state.reqIndex].qualification.id,
                bullet
              )
            }
            onUnlockSingle={(bulletId) =>
              dispatch({
                type: "UNLOCK_SINGLE_BULLET",
                qualId: scoreData.ranked_candidates[state.reqIndex].qualification.id,
                bulletId,
              })
            }
            onSkipTrait={() =>
              dispatch({
                type: "SKIP_TRAIT_REQ",
                qualId:
                  scoreData.ranked_candidates[state.reqIndex].qualification.id,
              })
            }
            onNext={() => dispatch({ type: "NEXT_REQ" })}
            onPrev={() => dispatch({ type: "PREV_REQ" })}
          />
        )}

        {state.currentStep === "fill_remaining" && (
          <FillRemainingStep
            scoreData={scoreData}
            lockedBullets={state.lockedBullets}
            allocation={state.allocation}
            remainingSlots={state.remainingSlots}
            jobId={jobId}
            token={token}
            onLockBullet={handleLockBullet}
            onNext={() => dispatch({ type: "NEXT_STEP" })}
          />
        )}

        {state.currentStep === "skills" && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold tracking-tight">Skills</h2>
            {scoreData.optimized_skills ? (
              <SkillsEditor
                skills={scoreData.optimized_skills}
                gapFilled={scoreData.skills_gap_filled || []}
                gapRemaining={scoreData.skills_gap_remaining || []}
                edits={state.skillEdits}
                deletions={state.skillDeletions}
                addedSkills={state.addedSkills}
                newSkillSections={state.newSkillSections}
                onEdit={(key, value) =>
                  dispatch({ type: "EDIT_SKILL", key, value })
                }
                onDelete={(idx) => dispatch({ type: "DELETE_SKILL", idx })}
                onUndoDelete={(idx) =>
                  dispatch({ type: "UNDO_DELETE_SKILL", idx })
                }
                onAddSkill={(category, skill) =>
                  dispatch({ type: "ADD_SKILL", category, skill })
                }
                onRemoveAddedSkill={(category, skill) =>
                  dispatch({ type: "REMOVE_ADDED_SKILL", category, skill })
                }
                onAddSection={(name, list) =>
                  dispatch({ type: "ADD_SKILL_SECTION", name, list })
                }
                onRemoveSection={(index) =>
                  dispatch({ type: "REMOVE_SKILL_SECTION", index })
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Skills optimization not available.
              </p>
            )}
            <div className="flex justify-end pt-2">
              <button
                onClick={() => dispatch({ type: "NEXT_STEP" })}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Continue to Generate
              </button>
            </div>
          </div>
        )}

        {state.currentStep === "generate" && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold tracking-tight">Generate Resume</h2>
            <GeneratePanel
              isGenerating={generateMutation.isPending}
              isGenerated={!!state.generated}
              basename={state.generated?.basename || null}
              summaryWarning={state.generated?.summaryWarning || null}
              lockedBullets={state.lockedBullets}
              summaryText={summaryText || ""}
              jdTitle={listing.title}
              jdRequiredQuals={listing.requiredQuals}
              jdPreferredQuals={listing.preferredQuals}
              jdResponsibilities={listing.responsibilities}
              skills={normalizeSkillsForRules(scoreData.optimized_skills || [])}
              addedSkills={state.addedSkills}
              newSkillSections={state.newSkillSections}
              previewPdfUrl={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3847"}/fit/${jobId}/preview/pdf?token=${token}`}
              onGenerate={() => generateMutation.mutate()}
              downloadPdfUrl={downloadUrl(jobId, "pdf", token)}
              downloadDocxUrl={downloadUrl(jobId, "docx", token)}
            />
            <div className="flex justify-end pt-2">
              <button
                onClick={() => dispatch({ type: "NEXT_STEP" })}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Continue to Outreach
              </button>
            </div>
          </div>
        )}

        {state.currentStep === "outreach" && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold tracking-tight">Outreach</h2>
            <OutreachPanel
              jobId={jobId}
              token={token}
              selectedBulletTexts={selectedBulletTexts}
            />
          </div>
        )}
      </div>

      {/* Right sidebar — allocation tracker */}
      {showAllocationSidebar && (
        <div className="w-52 shrink-0 hidden lg:block">
          <div className="sticky top-24">
            <AllocationTracker
              allocation={state.allocation}
              totalAssigned={state.totalBulletsAssigned}
              targetTotal={12}
            />
          </div>
        </div>
      )}
    </div>
  );
}
