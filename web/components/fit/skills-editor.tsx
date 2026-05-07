"use client";

import { X, Plus, AlertTriangle, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useState } from "react";

const LINE_CHAR_LIMIT = 110;

interface SkillCategory {
  category: string;
  items: string[];
}

/** Normalize backend shape (which may be {name, list} with comma-separated string) */
function normalizeSkills(raw: unknown[]): SkillCategory[] {
  return raw.map((s: any) => ({
    category: s.category || s.name || "Other",
    items: Array.isArray(s.items)
      ? s.items
      : typeof s.list === "string"
        ? s.list.split(",").map((x: string) => x.trim()).filter(Boolean)
        : [],
  }));
}

/** Compute the formatted line length: "Category: skill1, skill2, ..." */
function lineLength(category: string, items: string[]): number {
  return `${category}: ${items.join(", ")}`.length;
}

function lineLengthBadge(charCount: number) {
  return (
    <span className={cn(
      "text-[10px] font-mono px-1.5 py-0 rounded",
      charCount > LINE_CHAR_LIMIT
        ? "bg-rose-100 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400"
        : charCount > 95
          ? "bg-amber-100 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"
          : "bg-teal-100 text-teal-600 dark:bg-teal-950/30 dark:text-teal-400"
    )}>
      {charCount}/{LINE_CHAR_LIMIT}
    </span>
  );
}

interface SkillsEditorProps {
  skills: unknown[];
  gapFilled: string[];
  gapRemaining: string[];
  edits: Record<string, string>;
  deletions: Set<number>;
  addedSkills: Map<string, string[]>;
  newSkillSections: { name: string; list: string }[];
  onEdit: (key: string, value: string) => void;
  onDelete: (flatIndex: number) => void;
  onUndoDelete: (flatIndex: number) => void;
  onAddSkill: (category: string, skill: string) => void;
  onRemoveAddedSkill: (category: string, skill: string) => void;
  onAddSection: (name: string, list: string) => void;
  onRemoveSection: (index: number) => void;
}

export function SkillsEditor({
  skills,
  gapFilled,
  gapRemaining,
  edits,
  deletions,
  addedSkills,
  newSkillSections,
  onEdit,
  onDelete,
  onUndoDelete,
  onAddSkill,
  onRemoveAddedSkill,
  onAddSection,
  onRemoveSection,
}: SkillsEditorProps) {
  const normalized = normalizeSkills(skills);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newSkillText, setNewSkillText] = useState("");
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [newSectionSkills, setNewSectionSkills] = useState("");

  let flatIndex = 0;

  function handleAddSkill(category: string) {
    const trimmed = newSkillText.trim();
    if (trimmed) {
      onAddSkill(category, trimmed);
      setNewSkillText("");
      setAddingTo(null);
    }
  }

  function handleAddSection() {
    const name = newSectionName.trim();
    const list = newSectionSkills.trim();
    if (name && list) {
      onAddSection(name, list);
      setNewSectionName("");
      setNewSectionSkills("");
      setShowAddSection(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Skills</h3>

      <p className="text-xs text-muted-foreground">
        3 categories, max {LINE_CHAR_LIMIT} chars per line. Add skills or new categories below.
      </p>

      {/* Gap highlights */}
      {gapFilled.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {gapFilled.map((g) => (
            <Badge
              key={g}
              variant="secondary"
              className="text-[10px] bg-teal-50 text-teal-600 dark:bg-teal-950/20 dark:text-teal-300"
            >
              + {g}
            </Badge>
          ))}
        </div>
      )}

      {gapRemaining.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-md border border-slate-200 bg-slate-50/50 p-2 dark:border-slate-700 dark:bg-slate-900/20">
          <AlertTriangle className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
          <div className="flex flex-wrap gap-1">
            <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">Missing:</span>
            {gapRemaining.map((g) => (
              <Badge
                key={g}
                variant="outline"
                className="text-[10px] border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400"
              >
                {g}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Existing skill categories */}
      <div className="space-y-3">
        {normalized.map((cat) => {
          const startIndex = flatIndex;
          // Compute effective items (with edits/deletions/additions)
          const effectiveItems: string[] = [];
          cat.items.forEach((item, i) => {
            const idx = startIndex + i;
            if (!deletions.has(idx)) {
              const editKey = `${cat.category}:${i}`;
              effectiveItems.push(edits[editKey] ?? item);
            }
          });
          const added = addedSkills.get(cat.category) || [];
          const allItems = [...effectiveItems, ...added];
          const charCount = lineLength(cat.category, allItems);

          return (
            <div key={cat.category} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  {cat.category}
                </p>
                {lineLengthBadge(charCount)}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cat.items.map((item, i) => {
                  const idx = startIndex + i;
                  flatIndex++;
                  const isDeleted = deletions.has(idx);
                  const editKey = `${cat.category}:${i}`;
                  const editedValue = edits[editKey];

                  return (
                    <span
                      key={idx}
                      className={cn(
                        "inline-flex items-center gap-0.5 rounded-md border px-2 py-0.5 text-xs",
                        isDeleted
                          ? "border-red-200 bg-red-50 text-red-400 line-through dark:border-red-800 dark:bg-red-950/20"
                          : "border-border bg-card"
                      )}
                    >
                      {editedValue ?? item}
                      {isDeleted ? (
                        <button
                          onClick={() => onUndoDelete(idx)}
                          className="ml-0.5 text-red-400 hover:text-red-600"
                          aria-label="Undo delete"
                        >
                          undo
                        </button>
                      ) : (
                        <button
                          onClick={() => onDelete(idx)}
                          className="ml-0.5 text-muted-foreground hover:text-destructive"
                          aria-label="Remove skill"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  );
                })}

                {/* Added skills for this category */}
                {added.map((skill) => (
                  <span
                    key={`added-${skill}`}
                    className="inline-flex items-center gap-0.5 rounded-md border border-teal-200 bg-teal-50/50 px-2 py-0.5 text-xs text-teal-700 dark:border-teal-800 dark:bg-teal-950/20 dark:text-teal-300"
                  >
                    {skill}
                    <button
                      onClick={() => onRemoveAddedSkill(cat.category, skill)}
                      className="ml-0.5 text-teal-500 hover:text-destructive"
                      aria-label="Remove added skill"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}

                {/* Inline add skill */}
                {addingTo === cat.category ? (
                  <span className="inline-flex items-center gap-1">
                    <Input
                      value={newSkillText}
                      onChange={(e) => setNewSkillText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddSkill(cat.category);
                        if (e.key === "Escape") { setAddingTo(null); setNewSkillText(""); }
                      }}
                      placeholder="Skill name"
                      className="h-6 w-32 text-xs px-1.5"
                      autoFocus
                    />
                    <button
                      onClick={() => handleAddSkill(cat.category)}
                      className="text-teal-600 hover:text-teal-800 dark:text-teal-400"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => { setAddingTo(null); setNewSkillText(""); }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => { setAddingTo(cat.category); setNewSkillText(""); }}
                    className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-teal-300 hover:text-teal-600 transition-colors"
                  >
                    <Plus className="h-3 w-3" /> Add
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* New skill sections */}
      {newSkillSections.length > 0 && (
        <div className="space-y-2">
          {newSkillSections.map((sec, i) => {
            const items = sec.list.split(",").map((s) => s.trim()).filter(Boolean);
            const charCount = lineLength(sec.name, items);
            return (
              <Card key={i} className="p-3 border-teal-200 bg-teal-50/20 dark:border-teal-800/40 dark:bg-teal-950/10">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-teal-700 dark:text-teal-300">
                    {sec.name} (new)
                  </p>
                  <div className="flex items-center gap-2">
                    {lineLengthBadge(charCount)}
                    <button
                      onClick={() => onRemoveSection(i)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove section"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center rounded-md border border-teal-200 bg-teal-50/50 px-2 py-0.5 text-xs text-teal-700 dark:border-teal-800 dark:bg-teal-950/20 dark:text-teal-300"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add new category */}
      {showAddSection ? (
        <Card className="p-3 space-y-2 border-dashed">
          <p className="text-xs font-semibold text-muted-foreground">New Category</p>
          <Input
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            placeholder="Category name (e.g., AI/ML)"
            className="h-7 text-xs"
            autoFocus
          />
          <Input
            value={newSectionSkills}
            onChange={(e) => setNewSectionSkills(e.target.value)}
            placeholder="Skills, comma-separated (e.g., Vertex AI, TensorFlow, RAG)"
            className="h-7 text-xs"
            onKeyDown={(e) => { if (e.key === "Enter") handleAddSection(); }}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleAddSection}>
              <Plus className="mr-1 h-3 w-3" /> Add Category
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => {
              setShowAddSection(false); setNewSectionName(""); setNewSectionSkills("");
            }}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs border-dashed"
          onClick={() => setShowAddSection(true)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add New Category
        </Button>
      )}
    </div>
  );
}
