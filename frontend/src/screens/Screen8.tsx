import { useState, useEffect } from "react";
import { useApp } from "../store/AppContext";
import { AIBadge } from "../components/shared/AIBadge";
import { CustomizePromptModal } from "../components/shared/CustomizePromptModal";
import type { StudyDesignOption } from "../types";

const API = "http://localhost:8000/api";

const SECTION_COLORS = [
  "bg-blue-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-rose-500",
];

const RQ_FORMAT_COLORS: Record<string, string> = {
  pico:            "bg-blue-100 text-blue-700",
  predictive:      "bg-amber-100 text-amber-700",
  phenomenological:"bg-violet-100 text-violet-700",
  custom:          "bg-zinc-100 text-zinc-600",
};

// ── Final topic card ──────────────────────────────────────────────────────────
function FinalTopicCard({
  topic,
  selected,
  onSelect,
}: {
  topic: { id: string; title: string; description: string; rationale: string; keyThemes: string[]; researchQuestions: { format: string; label: string; text: string; recommended: boolean }[] };
  selected: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(selected);

  useEffect(() => { if (selected) setExpanded(true); }, [selected]);

  return (
    <div className={`rounded-lg border mb-2 overflow-hidden transition-colors ${
      selected ? "border-2 border-green-500 bg-green-50" : "border border-zinc-200 bg-white hover:bg-zinc-50"
    }`}>
      {/* Header — click to select */}
      <button className="w-full text-left px-3 py-2.5" onClick={onSelect}>
        <div className="flex items-start gap-2">
          <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${
            selected ? "border-green-500" : "border-zinc-300"
          }`}>
            {selected && <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-[11px] font-bold leading-snug ${selected ? "text-zinc-900" : "text-zinc-700"}`}>
              {topic.title}
            </p>
            <p className="text-[9px] text-zinc-500 mt-0.5 leading-relaxed">
              {topic.description}
            </p>
            {topic.rationale && (
              <p className="text-[9px] italic text-blue-600 mt-1 leading-relaxed">
                ✦ {topic.rationale}
              </p>
            )}
            {topic.keyThemes.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {topic.keyThemes.map((t) => (
                  <span key={t} className="px-1.5 py-0.5 bg-blue-50 border border-blue-200 text-blue-600 rounded text-[8px]">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </button>

      {/* RQs toggle */}
      {topic.researchQuestions.length > 0 && (
        <>
          <button
            className="w-full flex items-center gap-1.5 px-3 py-1.5 border-t border-zinc-100 bg-zinc-50 hover:bg-zinc-100 transition-colors"
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          >
            <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-wide flex-1 text-left">
              Research Questions ({topic.researchQuestions.length})
            </span>
            <span className="text-[9px] text-zinc-400">{expanded ? "▲" : "▼"}</span>
          </button>
          {expanded && (
            <div className="px-3 pb-2.5 pt-1.5 space-y-2.5 border-t border-zinc-100">
              {topic.researchQuestions.map((rq, i) => (
                <div key={i} className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-medium ${
                      RQ_FORMAT_COLORS[rq.format] ?? "bg-zinc-100 text-zinc-600"
                    }`}>
                      {rq.label}
                    </span>
                    {rq.recommended && (
                      <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[8px]">Recommended</span>
                    )}
                  </div>
                  <p className="text-[9px] text-zinc-600 leading-relaxed">{rq.text}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Study design card ─────────────────────────────────────────────────────────
function StudyDesignCard({ design, selected, onSelect }: { design: StudyDesignOption; selected: boolean; onSelect: () => void }) {
  return (
    <div onClick={onSelect} className={`rounded-lg border p-2.5 mb-2 cursor-pointer transition-colors ${
      selected ? "bg-green-50 border-2 border-green-500" : "bg-white border border-zinc-200 hover:bg-zinc-50"
    }`}>
      <div className="flex items-start gap-1.5">
        <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${
          selected ? "border-green-500" : "border-zinc-300"
        }`}>
          {selected && <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`text-[11px] leading-tight ${selected ? "font-bold text-zinc-900" : "font-medium text-zinc-700"}`}>
              {design.name}
            </span>
            {design.recommended && (
              <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full text-[8px]">Recommended</span>
            )}
          </div>
          <p className="text-[9px] italic text-zinc-400">{design.hint}</p>
        </div>
      </div>
    </div>
  );
}

// ── Main Screen8 ──────────────────────────────────────────────────────────────
export function Screen8() {
  const { state, dispatch } = useApp();
  const [generatingTopics, setGeneratingTopics] = useState(false);
  const [generatingStructure, setGeneratingStructure] = useState(false);
  const [topicError, setTopicError] = useState<string | null>(null);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [showTopicsModal, setShowTopicsModal] = useState(false);
  const [showStructureModal, setShowStructureModal] = useState(false);
  const [customTopicsPrompt, setCustomTopicsPrompt] = useState<string | null>(null);
  const [customStructurePrompt, setCustomStructurePrompt] = useState<string | null>(null);

  const finalTopicOptions = state.finalTopicOptions ?? [];
  const topicFinalData = state.topicFinalData ?? [];

  const selectedDesign = (state.studyDesignOptions ?? []).find((d) => d.id === state.selectedStudyDesignId);
  const selectedTopic = finalTopicOptions.find((t) => t.id === state.selectedFinalTopicId);
  const activeFinalData = topicFinalData.find((d) => d.topicId === state.selectedFinalTopicId);
  const paperSections = activeFinalData?.paperSections ?? [];

  // Build context payload shared by both API calls
  function buildContext() {
    return {
      gap_statement: state.gapStatement,
      profile: state.profile,
      themes: state.themes.map((t) => ({
        name: t.name,
        coverageLabel: t.coverageLabel,
        blocks: t.blocks.map((b) => ({ blockType: b.blockType, content: b.content })),
      })),
      gaps: state.gaps
        .filter((g) => g.selected)
        .map((g) => ({ label: g.label, description: g.description, type: g.type })),
    };
  }

  // Phase 1: generate final topic options from synthesis + gaps
  async function generateTopics(prompt?: string | null) {
    setGeneratingTopics(true);
    setTopicError(null);
    try {
      const res = await fetch(`${API}/final-question/generate-topics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...buildContext(), custom_system_prompt: prompt ?? null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.topics?.length) {
        dispatch({ type: "SET_FINAL_TOPIC_OPTIONS", options: data.topics });
      }
      if (data.study_designs?.length) {
        dispatch({ type: "SET_STUDY_DESIGN_OPTIONS", options: data.study_designs });
      }
    } catch (e: unknown) {
      setTopicError(e instanceof Error ? e.message : "Failed to generate topics");
    } finally {
      setGeneratingTopics(false);
    }
  }

  // Phase 2: generate paper structure for selected topic + design
  async function generateStructure(prompt?: string | null) {
    if (!selectedTopic) return;
    setGeneratingStructure(true);
    setStructureError(null);
    try {
      const res = await fetch(`${API}/final-question/generate-structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildContext(),
          custom_system_prompt: prompt ?? null,
          topic: {
            id: selectedTopic.id,
            title: selectedTopic.title,
            description: selectedTopic.description,
            rationale: selectedTopic.rationale,
            keyThemes: selectedTopic.keyThemes,
          },
          study_design: selectedDesign?.name ?? "Systematic Review",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.sections?.length) {
        dispatch({
          type: "SET_TOPIC_FINAL_DATA",
          data: [
            ...topicFinalData.filter((d) => d.topicId !== selectedTopic.id),
            {
              topicId: selectedTopic.id,
              researchQuestions: selectedTopic.researchQuestions,
              paperSections: data.sections,
            },
          ],
        });
      }
    } catch (e: unknown) {
      setStructureError(e instanceof Error ? e.message : "Failed to generate structure");
    } finally {
      setGeneratingStructure(false);
    }
  }

  // Auto-generate topics when Screen8 first loads
  useEffect(() => {
    if (finalTopicOptions.length === 0 && !generatingTopics) {
      generateTopics(null);
    }
  }, []);

  return (
    <>
    <div className="flex flex-col h-full">
      {/* Banner */}
      <div className="h-9 bg-zinc-950 flex items-center px-4 gap-2 shrink-0">
        <span className="text-[11px] text-zinc-500">Session:</span>
        <span className="text-[13px] text-white font-bold">{state.sessionTitle || "Untitled Session"}</span>
        <div className="flex-1" />
        <span className="text-[11px] text-zinc-500">Step 8 · Final Question</span>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Column 1 — AI-generated final topic options ── */}
        <div className="w-[300px] shrink-0 flex flex-col overflow-hidden border-r border-zinc-200 bg-white">
          <div className="px-3 pt-3 pb-2 flex items-center gap-2 shrink-0 border-b border-zinc-100">
            <div className="flex-1">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide">
                Final Topic Options
              </span>
              <p className="text-[8px] text-zinc-400 mt-0.5">
                AI-generated from your synthesis &amp; gaps
              </p>
            </div>
            <AIBadge />
            <div className="flex rounded overflow-hidden border border-zinc-200">
              <button
                onClick={() => generateTopics(customTopicsPrompt)}
                disabled={generatingTopics}
                className="flex items-center gap-1 px-2 h-6 text-[9px] text-zinc-500 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
              >
                {generatingTopics
                  ? <span className="w-2.5 h-2.5 border border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
                  : "↺"}
                {customTopicsPrompt && <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0" />}
                {generatingTopics ? "Generating…" : "Regenerate"}
              </button>
              <button
                onClick={() => setShowTopicsModal(true)}
                disabled={generatingTopics}
                title="Customize AI prompt"
                className="px-1.5 h-6 border-l border-zinc-200 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 text-[10px] disabled:opacity-50 transition-colors"
              >
                ⚙
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2.5 py-2.5">
            {generatingTopics ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <span className="w-6 h-6 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
                <p className="text-[10px] text-zinc-500">Synthesising your research journey<br />into final topic options…</p>
              </div>
            ) : topicError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center">
                <p className="text-[10px] text-red-600 mb-2">{topicError}</p>
                <button onClick={() => generateTopics(customTopicsPrompt)} className="px-3 h-7 bg-red-600 text-white rounded text-[10px] hover:bg-red-700">
                  Retry
                </button>
              </div>
            ) : finalTopicOptions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center text-xl">✦</div>
                <p className="text-[10px] text-zinc-500">No topics generated yet.</p>
                <button onClick={() => generateTopics(customTopicsPrompt)} className="px-4 h-8 bg-blue-600 text-white rounded text-[11px] font-medium hover:bg-blue-700">
                  Generate Topics
                </button>
              </div>
            ) : (
              <>
                {finalTopicOptions.map((topic) => (
                  <FinalTopicCard
                    key={topic.id}
                    topic={topic}
                    selected={state.selectedFinalTopicId === topic.id}
                    onSelect={() => dispatch({ type: "SELECT_FINAL_TOPIC", topicId: topic.id })}
                  />
                ))}
                {/* Gap statement reference */}
                {state.gapStatement && (
                  <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-2.5 mt-1">
                    <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-wide mb-1">Based on Gap Statement</p>
                    <p className="text-[9px] text-zinc-500 leading-relaxed line-clamp-4">{state.gapStatement}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Column 2 — Study Design ── */}
        <div className="w-[200px] shrink-0 flex flex-col overflow-hidden border-r border-zinc-200 bg-white">
          <div className="px-3 pt-3 pb-2 border-b border-zinc-100 shrink-0">
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide">Study Design</span>
            <p className="text-[8px] text-zinc-400 mt-0.5">Shapes paper structure</p>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {state.studyDesignOptions.map((design) => (
              <StudyDesignCard
                key={design.id}
                design={design}
                selected={design.id === state.selectedStudyDesignId}
                onSelect={() => dispatch({ type: "SELECT_STUDY_DESIGN", designId: design.id })}
              />
            ))}
          </div>
        </div>

        {/* ── Column 3 — Paper Structure ── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white">
          <div className="px-3 pt-3 pb-2 border-b border-zinc-100 shrink-0 flex items-center gap-2">
            <div className="flex-1">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide">Paper Structure</span>
              {selectedTopic && (
                <p className="text-[8px] text-zinc-500 mt-0.5 truncate max-w-[360px]">{selectedTopic.title}</p>
              )}
            </div>
            {selectedDesign && (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-[9px] font-medium shrink-0">
                {selectedDesign.name}
              </span>
            )}
            {selectedTopic && (
              <div className="flex rounded overflow-hidden">
                <button
                  onClick={() => generateStructure(customStructurePrompt)}
                  disabled={generatingStructure}
                  className="flex items-center gap-1 px-2.5 h-6 bg-blue-600 text-white rounded-l text-[9px] font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors shrink-0"
                >
                  {generatingStructure
                    ? <span className="w-2.5 h-2.5 border border-white/40 border-t-white rounded-full animate-spin" />
                    : "✦"}
                  {customStructurePrompt && <span className="w-1 h-1 rounded-full bg-amber-300 shrink-0" />}
                  {generatingStructure ? "Generating…" : "Generate Structure"}
                </button>
                <button
                  onClick={() => setShowStructureModal(true)}
                  disabled={generatingStructure}
                  title="Customize AI prompt"
                  className="px-1.5 h-6 bg-blue-700 text-blue-200 text-[10px] hover:bg-blue-600 disabled:opacity-50 transition-colors border-l border-blue-500 rounded-r"
                >
                  ⚙
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3">
            {generatingStructure ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-16">
                <span className="w-8 h-8 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
                <p className="text-[11px] text-zinc-500">Building academic paper structure<br />tailored to your topic and design…</p>
              </div>
            ) : structureError ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                <p className="text-[11px] text-red-500">{structureError}</p>
                <button onClick={() => generateStructure(customStructurePrompt)} className="px-4 h-8 bg-red-600 text-white rounded text-[11px] hover:bg-red-700">
                  Retry
                </button>
              </div>
            ) : paperSections.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-16">
                <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center text-xl">📄</div>
                <div>
                  <p className="text-[12px] font-semibold text-zinc-700">No structure yet</p>
                  <p className="text-[10px] text-zinc-400 mt-1 max-w-[280px]">
                    {selectedTopic
                      ? "Click \"Generate Structure\" above to create an AI-tailored paper structure for this topic and design."
                      : "Select a topic on the left first, then generate the paper structure."}
                  </p>
                </div>
                {selectedTopic && (
                  <button
                    onClick={() => generateStructure(customStructurePrompt)}
                    disabled={generatingStructure}
                    className="px-4 h-8 bg-blue-600 text-white rounded text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    Generate Structure
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {paperSections.map((section, idx) => {
                  const accent = SECTION_COLORS[idx % SECTION_COLORS.length];
                  return (
                    <div key={section.number} className="flex rounded-lg border border-zinc-200 bg-white overflow-hidden">
                      <div className={`w-[3px] shrink-0 ${accent}`} />
                      <div className="flex-1 p-3">
                        <div className="flex items-baseline gap-1.5 mb-1">
                          <span className={`text-[11px] font-bold ${accent.replace("bg-", "text-")}`}>{section.number}.</span>
                          <span className="text-[12px] font-bold text-zinc-900">{section.name}</span>
                        </div>
                        <p className="text-[9px] italic text-zinc-500 mb-2 leading-relaxed">{section.purpose}</p>
                        <ul className="space-y-1">
                          {(section.bullets ?? []).map((bullet, bi) => (
                            <li key={bi} className="flex items-start gap-1.5">
                              <span className={`mt-[4px] w-1 h-1 rounded-full shrink-0 ${accent}`} />
                              <span className="text-[10px] text-zinc-700 leading-relaxed">{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="h-12 border-t border-zinc-200 bg-white flex items-center px-4 justify-between shrink-0">
        <button
          onClick={() => dispatch({ type: "SET_STEP", step: 7 })}
          className="px-4 h-8 border border-zinc-300 rounded text-[11px] text-zinc-700 hover:bg-zinc-50"
        >
          ← Back to Gap Statement
        </button>
        <div className="flex items-center gap-3">
          {selectedTopic && (
            <span className="text-[10px] text-zinc-500 max-w-[300px] truncate">
              Topic: <span className="font-semibold text-zinc-700">{selectedTopic.title}</span>
            </span>
          )}
          <button
            onClick={() => alert("Generating Research Plan PDF...")}
            disabled={!selectedTopic || paperSections.length === 0}
            className="px-5 h-8 bg-green-600 text-white rounded text-[12px] font-semibold hover:bg-green-700 disabled:opacity-40 transition-colors"
          >
            Confirm &amp; Export Research Plan
          </button>
        </div>
      </div>
    </div>

    {showTopicsModal && (
      <CustomizePromptModal
        promptKey="final-topics"
        title="Generate Final Topics"
        initialCustomPrompt={customTopicsPrompt}
        onClose={() => setShowTopicsModal(false)}
        onGenerate={(prompt) => {
          setCustomTopicsPrompt(prompt)
          setShowTopicsModal(false)
          generateTopics(prompt)
        }}
      />
    )}
    {showStructureModal && (
      <CustomizePromptModal
        promptKey="final-structure"
        title="Generate Paper Structure"
        initialCustomPrompt={customStructurePrompt}
        onClose={() => setShowStructureModal(false)}
        onGenerate={(prompt) => {
          setCustomStructurePrompt(prompt)
          setShowStructureModal(false)
          generateStructure(prompt)
        }}
      />
    )}
    </>
  );
}
