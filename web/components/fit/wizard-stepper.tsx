"use client";

import { CheckCircle, Circle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WizardStepId } from "@/lib/types";
import { STEP_ORDER, stepLabel } from "@/lib/wizard-state";

interface WizardStepperProps {
  currentStep: WizardStepId;
  reqIndex: number;
  totalReqs: number;
  completedSteps: Set<WizardStepId>;
  onGoToStep: (step: WizardStepId) => void;
}

export function WizardStepper({
  currentStep,
  reqIndex,
  totalReqs,
  completedSteps,
  onGoToStep,
}: WizardStepperProps) {
  return (
    <nav className="space-y-1">
      {STEP_ORDER.map((step) => {
        const isCurrent = step === currentStep;
        const isCompleted = completedSteps.has(step);
        const canNavigate = isCompleted;
        const label = stepLabel(step);

        // Sub-progress for requirements step
        const subLabel =
          step === "requirement" && (isCurrent || isCompleted)
            ? `${Math.min(reqIndex + 1, totalReqs)}/${totalReqs}`
            : null;

        return (
          <button
            key={step}
            onClick={() => canNavigate && onGoToStep(step)}
            disabled={!canNavigate && !isCurrent}
            className={cn(
              "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors text-left",
              isCurrent
                ? "bg-indigo-50 text-indigo-700 font-medium dark:bg-indigo-950/30 dark:text-indigo-300"
                : isCompleted
                  ? "text-foreground hover:bg-muted/50 cursor-pointer"
                  : "text-muted-foreground cursor-default"
            )}
          >
            {isCompleted ? (
              <CheckCircle className="h-4 w-4 text-teal-500 shrink-0" />
            ) : isCurrent ? (
              <ChevronRight className="h-4 w-4 text-indigo-500 shrink-0" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
            )}
            <span className="flex-1">{label}</span>
            {subLabel && (
              <span className="text-xs text-muted-foreground font-mono">
                {subLabel}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
