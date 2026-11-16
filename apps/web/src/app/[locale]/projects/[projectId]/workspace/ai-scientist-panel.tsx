"use client";
import { aiTimestamp, contiguousEventSequence, mergeRunEvents } from "@/lib/ai-scientist-workflow";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AISettingsView,
  ProductContext,
  AICitation,
  AIConversationDetail,
  AIRunView,
  AIRunEventView,
  Decision,
  InvestigationView,
  ComputeJobView,
} from "@chemdft/schemas";
import type { WorkspaceSelection } from "@/lib/workspace-selection";
import { aiProgress, runBusy } from "@/lib/workstation-ux";
import { selectionKey } from "@/lib/workspace-selection";
import { latestEvidenceSelection, messagesForContext } from "@/lib/ai-evidence-selection";
import { aiRunPayload, associatedAiContext, selectedConformerContext } from "@/lib/ai-workspace-context";
import { resolveAiContext, type ResolvedAiContext } from "@/lib/ai-context";
import { useAiConversationState } from "./ai-conversation-state";
import { AIScientistComposer, type ComposerMode, type PlanningProfile } from "./ai-scientist-composer";
import { AIScientistChatTab } from "./ai-scientist-chat-tab";

import {
  cancelAiRun,
  pauseAiRun,
  createAiConversation,
  decideAiApproval,
  getAiConversation,
  getAiRunEvents,
  getProductContextOrFallback,
  getAiRun,
  getAiSettings,
  listAiConversations,
  postAiMessage,
  resumeAiRun,
} from "@/lib/ai-scientist-api";
import { getCalculation } from "@/lib/structure-workspace-api";
import { useOptionalWorkspaceState } from "@/app/_components/workspace-state-provider";
import {
  createInvestigation,
  decideInvestigationApproval,
  listInvestigations,
  startInvestigation,
} from "@/lib/investigations-api";
import { AIScientistHeader, type AIScientistTab } from "./ai-scientist-header";
import { AIScientistToolsTab } from "./ai-scientist-tools-tab";
import { AIScientistEvidenceTab } from "./ai-scientist-evidence-tab";
import { AIScientistRunsTab } from "./ai-scientist-runs-tab";
import { AIScientistSettingsTab } from "./ai-scientist-settings-tab";
import { ApprovalCard } from "./ai-scientist-approval-screen";

export { ApprovalCard };


export type WorkspaceScope = {
  projectName?: string;
  structureName?: string;
  structureVersionRevision?: number;
  documentName?: string;
  datasetName?: string;
  selectionName?: string;
  currentView?: string;
  calculationId?: string;
  resultId?: string;
  selectedModeIndex?: number;
  selectedModeFrequency?: number;
  selectedModeIntensity?: number;
};

interface AIScientistPanelProps {
  visible?: boolean;
  projectId: string;
  scope?: WorkspaceScope;
  currentSelection?: WorkspaceSelection | null;
  currentViewLabel?: string;
  /** The page's resolved AI context. When absent it is built from `currentSelection`/`currentViewLabel` (Workspace bridge). */
  aiContext?: ResolvedAiContext;
  onCitationClick?: (citation: AICitation) => void;
  onSelectInspector?: (() => void) | undefined;
  isAdvanced?: boolean | undefined;
  onClose?: (() => void) | undefined;
}


export function AIScientistPanel({
  visible = true,
  projectId,
  scope,
  currentSelection: legacySelection,
  currentViewLabel,
  aiContext,
  onCitationClick,
  onSelectInspector,
  isAdvanced = false,
  onClose,
}: AIScientistPanelProps) {
  const legacyView = currentViewLabel ?? scope?.currentView ?? (scope?.projectName ? `${scope.projectName} → Overview` : "Project overview");
  const ctx = aiContext ?? resolveAiContext(projectId, scope?.projectName ?? "Project", { page: "workspace", label: legacyView, selection: legacySelection ?? null });
  const effectiveView = ctx.viewLabel;
  const contextHints = ctx.hints;
  const currentSelection = ctx.selection;
  // A saved model preference changes ProductContext.ai, so a settings save re-reads the context.
  const [settingsRevision, setSettingsRevision] = useState(0);
  const requestKey = JSON.stringify({ projectId, page: ctx.page, key: ctx.key, selection: currentSelection, hints: contextHints, settingsRevision });
  const [contextRecord, setContextRecord] = useState<{ key: string; context?: ProductContext; error?: string } | null>(null);
  const productContext = contextRecord?.key === requestKey ? contextRecord.context ?? null : null;
  const contextError = contextRecord?.key === requestKey ? contextRecord.error : null;
  const conformerContext = selectedConformerContext(productContext) || effectiveView.startsWith("CREST ensemble");
  const aiAvailable = Boolean(productContext?.ai.available && !conformerContext);
  const contextKey = ctx.key;
  const { turnStarts, setTurnStarts, prompt, setPrompt, runOrigins, setRunOrigins, submitOrigin, setSubmitOrigin } = useAiConversationState(contextKey);
  const [conversation, setConversation] = useState<AIConversationDetail | null>(null);
  const [activeRun, setActiveRun] = useState<AIRunView | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<AIScientistTab>("chat");
  const [isExpanded, setIsExpanded] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>("ask");
  const [generalPlan, setGeneralPlan] = useState(false);
  const isCrystalOrPeriodic = useMemo(() => {
    const text = `${effectiveView} ${contextHints?.current_view ?? ""} ${scope?.structureName ?? ""}`.toLowerCase();
    const resourceLabels = (productContext?.resources ?? []).map((r) => r.label ?? "").join(" ").toLowerCase();
    const facts = (productContext?.grounding_facts ?? []).join(" ").toLowerCase();
    return text.includes("crystal") || text.includes("periodic") || text.includes("unit cell") || text.includes("lattice")
      || resourceLabels.includes("crystal") || resourceLabels.includes("periodic")
      || facts.includes("periodic_cell") || facts.includes("periodic") || facts.includes("unit cell");
  }, [effectiveView, contextHints, scope?.structureName, productContext?.resources, productContext?.grounding_facts]);

  // Mirrors the backend profile preconditions (saved version selected, editable project).
  const energyPlanningReady = Boolean(productContext?.selection.selected_structure_version_id && productContext.can_write && !productContext.sealed);
  const canPreparePeriodicCalculation = Boolean(energyPlanningReady && isCrystalOrPeriodic);
  const canPrepareCalculation = Boolean((energyPlanningReady && !isCrystalOrPeriodic) || (generalPlan && productContext?.can_write && !productContext?.sealed));
  const canProposeStructureEdit = Boolean(energyPlanningReady);
  // Server registry decides which request types the active model may serve; show its reason, never a silent disable.
  const proposalProfile = generalPlan ? "GENERAL" : isCrystalOrPeriodic ? "PERIODIC_ENERGY_PROPOSAL" : "PYSCF_ENERGY_PROPOSAL";

  // Ask: cited evidence answers, never actions. Plan: the tool-using planner — scoped to a periodic
  // or PySCF energy proposal when a saved version is selected, otherwise the general planner (drafts need
  // review, calculations need approval). Chosen by context, never by keywords in the prompt.
  const composerProfile: PlanningProfile = composerMode === "plan" && energyPlanningReady && !generalPlan
    ? (isCrystalOrPeriodic ? "PERIODIC_ENERGY_PROPOSAL" : "PYSCF_ENERGY_PROPOSAL")
    : "GENERAL";
  const composerRequestMode = composerMode === "plan" ? "STANDARD" as const : "CHAT" as const;
  const composerBlockedReason = composerMode === "plan" && productContext && (!productContext.can_write || productContext.sealed)
    ? "Plan calculation needs an editable project. Ask still works here."
    : null;
  // Plan without a saved version is never downgraded silently: the researcher selects a version
  // (scoped energy proposal) or explicitly chooses the general planner (find, draft or import a
  // structure, extract document figures). With a version, the general planner is an explicit opt-in too.
  const planNeedsVersion = composerMode === "plan" && Boolean(productContext) && !composerBlockedReason && !energyPlanningReady;
  const planAwaitingChoice = planNeedsVersion && !generalPlan;
  const candidateSelection = currentSelection?.kind === "structureCandidate" || currentSelection?.kind === "candidateRepresentation";
  // The server may resolve the project's current version when nothing is selected (Navigator facts);
  // name that version instead of the view label so the proposal target is never ambiguous.
  const planningVersionChosenByServer = Boolean(productContext?.selection.selected_structure_version_id && !contextHints.selected_structure_version_id);
  const [limitRun, setLimitRun] = useState(false);
  const [runLimitValues, setRunLimitValues] = useState({ calls: "2", input: "60000", output: "4096" });
  const runLimits = {
    max_model_calls: Number(runLimitValues.calls),
    max_input_tokens: Number(runLimitValues.input),
    max_output_tokens: Number(runLimitValues.output),
  };
  const validRunLimits = !limitRun || (
    Number.isInteger(runLimits.max_model_calls) && runLimits.max_model_calls >= 1 && runLimits.max_model_calls <= 15
    && Number.isInteger(runLimits.max_input_tokens) && runLimits.max_input_tokens >= 1 && runLimits.max_input_tokens <= 60000
    && Number.isInteger(runLimits.max_output_tokens) && runLimits.max_output_tokens >= 1 && runLimits.max_output_tokens <= 12000
  );
  const [error, setError] = useState<string | null>(null);
  const [investigation, setInvestigation] = useState<InvestigationView | null>(null);
  const [investigationObjective, setInvestigationObjective] = useState("");
  const [creatingInvestigation, setCreatingInvestigation] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const previousRunRef = useRef<string | undefined>(undefined);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [queuedComparisonPrompt, setQueuedComparisonPrompt] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);
  const focusAfterSubmissionRef = useRef(false);
  const sendMessageRef = useRef<(messageText?: string, mode?: "STANDARD" | "EVIDENCE" | "CHAT", profile?: PlanningProfile) => Promise<void>>(async () => {});

  const workspace = useOptionalWorkspaceState();
  const savedVersions = (workspace?.catalog ?? []).filter((item) =>
    item.selection.kind === "structureVersion" && item.selection.projectId === projectId);
  const planningVersionId = productContext?.selection.selected_structure_version_id ?? null;
  const planningVersionLabel = (planningVersionId && savedVersions.find((item) => item.selection.id === planningVersionId)?.label)
    || productContext?.resources.find((resource) => resource.entity_type === "structure.version" && resource.entity_id === planningVersionId)?.label
    || null;
  const [aiSettings, setAiSettings] = useState<AISettingsView | null>(null);
  useEffect(() => {
    let alive = true;
    void getAiSettings().then((view) => { if (alive) setAiSettings(view); }).catch(() => { if (alive) setAiSettings(null); });
    return () => { alive = false; };
  }, [settingsRevision]);
  const activeModelCapability = aiSettings?.model_capabilities?.find((row) =>
    row.model_identifier === productContext?.ai.model && row.provider === productContext?.ai.provider) ?? null;
  const proposalReasons = {
    model: activeModelCapability && Array.isArray(activeModelCapability.planning_profiles) && !(activeModelCapability.planning_profiles as readonly string[]).includes(proposalProfile)
      ? `The selected model is not eligible for this request type (it covers: ${(activeModelCapability.planning_profiles as readonly string[]).join(", ") || "none"}). Choose another model.`
      : null,
    selection: !productContext || generalPlan ? null
      : !productContext.can_write || productContext.sealed ? "This project is read-only, so proposals cannot be prepared."
      : !productContext.selection.selected_structure_version_id ? "Select a saved structure version first (an unsaved structure cannot be calculated)."
      : null,
  };
  const [followAiMode, setFollowAiMode] = useState(true);
  const [deferredApprovalId, setDeferredApprovalId] = useState<string | null>(null);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  // Run history from existing records only: runs referenced by this conversation's messages.
  const [historyRuns, setHistoryRuns] = useState<Record<string, AIRunView>>({});
  const waitingCalculationId = activeRun?.status === "WAITING_FOR_CALCULATION" && typeof activeRun.waiting_calculation_id === "string" && activeRun.waiting_calculation_id
    ? activeRun.waiting_calculation_id
    : undefined;
  const [waitingComputeJob, setWaitingComputeJob] = useState<ComputeJobView | null>(null);

  useEffect(() => {
    if (!waitingCalculationId) return;
    const targetCalcId: string = waitingCalculationId;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const detail = await getCalculation({ projectId, calculationId: targetCalcId });
        if (!alive) return;
        setWaitingComputeJob(detail.compute_job ?? null);
        if (detail.compute_job && !["SUCCEEDED", "FAILED", "CANCELED"].includes(detail.compute_job.state)) {
          timer = setTimeout(() => void poll(), 3000);
        }
      } catch {
        if (alive) setWaitingComputeJob(null);
      }
    }

    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [projectId, waitingCalculationId]);
  const [events, setEvents] = useState<AIRunEventView[]>([]);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [runReadError, setRunReadError] = useState<string | null>(null);
  const eventCacheRef = useRef<{ runId: string; rows: AIRunEventView[]; reading: boolean } | null>(null);
  const actionLockRef = useRef(false);
  const [clarificationInput, setClarificationInput] = useState("");
  const followedCandidateRef = useRef<string | null>(null);

  const conversationId = conversation?.conversation.id;
  const activeRunId = activeRun?.id ?? conversation?.latest_run?.id;
  const isRunActive = runBusy(activeRun);
  const isRunPaused = activeRun?.status === "PAUSED";
  const progress = activeRun?.status === "WAITING_FOR_APPROVAL" ? null
    : activeRun?.status === "WAITING_FOR_CALCULATION" ? "Calculation submitted · checking execution status…" : aiProgress(activeRun, submitting);

  const userScrolledAwayRef = useRef(false);
  const prevMessageCountRef = useRef(0);

  // In the docked panel the conversation scroll area (.ai-conversation-scroll) is the true scroll container.
  const chatScroller = useCallback((): HTMLElement | null => {
    return scrollRef.current;
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const handleScroll = () => {
      const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      userScrolledAwayRef.current = distanceFromBottom > 60;
    };
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToBottom = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller || scroller.clientHeight === 0) return;
    // The empty state (title, explanation, starters) is read from its top.
    if (scroller.querySelector('[data-testid="ai-empty-state"]')) { scroller.scrollTop = 0; return; }
    const assistantBubbles = scroller.querySelectorAll<HTMLElement>(".ai-message-bubble.assistant");
    const newestAssistant = assistantBubbles[assistantBubbles.length - 1];
    if (!isRunActive && !pendingQuestion && newestAssistant) {
      // A long answer should arrive at its beginning, with its own citations below.
      const scrollerRect = scroller.getBoundingClientRect();
      const bubbleRect = newestAssistant.getBoundingClientRect();
      const targetTop = scroller.scrollTop + (bubbleRect.top - scrollerRect.top) - 8;
      const prefersReduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      scroller.scrollTo({
        top: Math.max(0, targetTop),
        behavior: prefersReduced ? "auto" : "smooth",
      });
    } else {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [isRunActive, pendingQuestion]);

  const loadConversation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listAiConversations(projectId);
      const convs = list.conversations ?? [];
      if (convs.length > 0) {
        const first = convs[0];
        if (first) {
          const detail = await getAiConversation(projectId, first.id);
          setConversation(detail);
          setActiveRun(detail.latest_run ? await getAiRun(projectId, detail.latest_run.id) : null);
        }
      } else {
        setConversation(null);
        setActiveRun(null);
      }
      const investigations = await listInvestigations(projectId);
      setInvestigation(investigations.investigations?.[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load AI Scientist conversations.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadConversation();
    });
    return () => {
      cancelled = true;
    };
  }, [loadConversation]);

  useEffect(() => {
    let active = true;
    const request = JSON.parse(requestKey) as { projectId: string; selection: WorkspaceSelection | null | undefined; hints: ResolvedAiContext["hints"] };
    const load = getProductContextOrFallback(request.projectId, request.hints); // id hints never become an error banner
    void load.then((context) => {
      const associated = associatedAiContext(context, request.projectId, request.selection, request.hints);
      if (active) setContextRecord({ key: requestKey, context: associated });
    }).catch((cause: unknown) => {
      if (active) setContextRecord({ key: requestKey, error: cause instanceof Error ? cause.message : "AI context is unavailable." });
    });
    return () => { active = false; };
  }, [requestKey]);

  useEffect(() => {
    const currentCount = conversation?.messages?.length ?? 0;
    if (currentCount > prevMessageCountRef.current) {
      prevMessageCountRef.current = currentCount;
      if (!visible) return;
      if (!userScrolledAwayRef.current) {
        window.requestAnimationFrame(() => {
          scrollToBottom();
        });
      }
    } else {
      prevMessageCountRef.current = currentCount;
    }
  }, [conversation?.messages?.length, visible, scrollToBottom]);

  // A run that ended without a valid proposal explains itself at the end of the conversation:
  // reveal it once, when it appears, so its cause and its retry are in view.
  const blockerRunId = activeRun?.status === "FAILED" && activeRun.blocker ? activeRun.id : null;
  useEffect(() => {
    if (!blockerRunId || !visible) return;
    const frame = window.requestAnimationFrame(() => {
      const scroller = chatScroller();
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [blockerRunId, visible, chatScroller]);

  useEffect(() => {
    const panel = scrollRef.current;
    if (!panel) return;
    let previousHeight = 0;
    const observer = new ResizeObserver(() => {
      if (previousHeight === 0 && panel.clientHeight > 0) scrollToBottom();
      previousHeight = panel.clientHeight;
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  // The POST endpoint commits run/context/steps before its final response.
  // Read those real records while the request is pending; no simulated stages.
  useEffect(() => {
    if (!submitting || !conversationId) return;
    let reading = false, active = true;
    const timer = window.setInterval(async () => {
      if (reading) return;
      reading = true;
      try {
        const detail = await getAiConversation(projectId, conversationId);
        if (active && detail.latest_run && detail.latest_run.id !== previousRunRef.current) {
          setActiveRun(detail.latest_run);
          setConversation(detail);
          setPendingQuestion(null);
        }
      } catch { /* Original request owns failure feedback; transient reads retry. */ }
      finally { reading = false; }
    }, 500);
    return () => { active = false; window.clearInterval(timer); };
  }, [submitting, conversationId, projectId]);

  useEffect(() => {
    if (!submitting && !isRunActive) return;
    const start = startedAt ?? aiTimestamp(activeRun?.created_at ?? "");
    if (!Number.isFinite(start)) return;
    const timer = window.setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [submitting, isRunActive, startedAt, activeRun?.created_at]);

  const refreshRun = useCallback(async () => {
    if (!activeRunId) return;
    try {
      const updated = await getAiRun(projectId, activeRunId);
      setActiveRun(updated);
      setRunReadError(null);
    } catch (cause) {
      setRunReadError(cause instanceof Error ? cause.message : "Couldn't refresh this run. You're seeing the last saved state.");
    }
  }, [activeRunId, projectId]);

  // Poll durable state without overlapping reads, including paused and approval gates.
  useEffect(() => {
    if (!activeRunId) return;
    let alive = true, reading = false;
    const poll = async () => {
      if (reading) return;
      reading = true;
      try {
        const updated = await getAiRun(projectId, activeRunId);
        if (!alive) return;
        setActiveRun(updated);
        setRunReadError(null);
        if (["SUCCEEDED", "FAILED", "CANCELED", "PAUSED", "WAITING_FOR_APPROVAL"].includes(updated.status) && conversationId) {
          const detail = await getAiConversation(projectId, conversationId);
          if (alive) setConversation(detail);
        }
      } catch (cause) {
        if (alive) setRunReadError(cause instanceof Error ? cause.message : "Couldn't refresh this run. You're seeing the last saved state.");
      } finally { reading = false; }
    };
    const interval = window.setInterval(() => void poll(), 2500);
    return () => { alive = false; window.clearInterval(interval); };
  }, [activeRunId, conversationId, projectId]);

  const fetchEvents = useCallback(async (runId: string) => {
    let cache = eventCacheRef.current;
    if (!cache || cache.runId !== runId) {
      cache = { runId, rows: [], reading: false };
      eventCacheRef.current = cache;
      setEvents([]);
      setEventLoading(true);
    }
    if (cache.reading) return;
    cache.reading = true;
    try {
      // Backend replay pages contain at most 1000 entries. Each bounded pass retains its cursor.
      for (let page = 0; page < 20; page += 1) {
        const cursor = contiguousEventSequence(cache.rows);
        const data = await getAiRunEvents(projectId, runId, cursor);
        if (eventCacheRef.current !== cache) return;
        cache.rows = mergeRunEvents(cache.rows, data.events ?? [], projectId, runId);
        setEvents(cache.rows);
        const next = contiguousEventSequence(cache.rows);
        if (cache.rows.some(event => event.sequence > next)) throw new Error("The activity list is missing a step. Showing what was saved; reconnecting.");
        setEventError(null);
        if ((data.events?.length ?? 0) < 1000) return;
        if (next <= cursor) throw new Error("The activity list stopped updating. Reconnect to continue.");
      }
    } catch (cause) {
      if (eventCacheRef.current === cache) setEventError(cause instanceof Error ? cause.message : "The activity list is unavailable. Showing what was saved.");
    } finally { cache.reading = false; if (eventCacheRef.current === cache) setEventLoading(false); }
  }, [projectId]);

  useEffect(() => {
    eventCacheRef.current = null;
    if (!activeRunId) { queueMicrotask(() => setEvents([])); return; }
    queueMicrotask(() => void fetchEvents(activeRunId));
    const interval = window.setInterval(() => void fetchEvents(activeRunId), 2500);
    return () => { eventCacheRef.current = null; window.clearInterval(interval); };
  }, [activeRunId, fetchEvents]);

  // New drafts must appear in the project explorer even when the researcher chose "Stay Here".
  const announcedDraftsRef = useRef(0);
  useEffect(() => {
    const created = events.filter((e) => e.event_type === "object.created" || e.event_type === "object.reused").length;
    if (created > announcedDraftsRef.current) window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
    announcedDraftsRef.current = created;
  }, [events]);

  // Follow AI navigation
  useEffect(() => {
    if (!followAiMode || !workspace || workspace.unsavedWork) return;

    const createdEvents = events.filter(
      (e) => e.event_type === "object.created" || e.event_type === "object.reused",
    );
    if (createdEvents.length === 0) return;

    const latest = createdEvents[createdEvents.length - 1];
    if (!latest) return;
    const cid = String(latest.payload?.candidate_id ?? "");
    if (!cid || cid === followedCandidateRef.current) return;

    followedCandidateRef.current = cid;
    const name = String(latest.payload?.name ?? "Candidate");
    const formula = String(latest.payload?.formula ?? "");
    const label = formula ? `${name} (${formula})` : name;

    // Following the AI moves the workspace context; keep the run's own turn (and its activity
    // timeline) on screen instead of folding it into "Previous conversation".
    const nextKey = selectionKey({ kind: "geometryCandidate", id: cid, projectId });
    setTurnStarts((old) => (old[nextKey] === undefined ? { ...old, [nextKey]: old[contextKey] ?? 0 } : old));
    workspace.openSelection(
      { kind: "geometryCandidate", id: cid, projectId },
      label,
    );
  }, [events, followAiMode, workspace, projectId, contextKey, setTurnStarts]);

  useEffect(() => {
    if (!investigation) return;
    const activeStatuses = ["ACTIVE", "WAITING_FOR_RESULT", "WAITING_FOR_APPROVAL"];
    if (!activeStatuses.includes(investigation.status)) return;
    const interval = window.setInterval(async () => {
      try {
        const current = await listInvestigations(projectId);
        setInvestigation(current.investigations?.[0] ?? null);
      } catch {
        // Investigation state is durable; transient polling errors are harmless.
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, [investigation, projectId]);

  useEffect(() => {
    const start = turnStarts[contextKey];
    const messages = start === undefined || submitting ? [] : (conversation?.messages ?? []).slice(start);
    window.dispatchEvent(new CustomEvent("chemdft:evidence-message", { detail: latestEvidenceSelection(messages) }));
  }, [conversation, contextKey, turnStarts, submitting]);

  useEffect(() => {
    if (submitting || !focusAfterSubmissionRef.current) return;
    focusAfterSubmissionRef.current = false;
    promptInputRef.current?.focus();
  }, [submitting]);

  function handleAskSubmit() {
    if (composerMode === "plan") {
      if (isCrystalOrPeriodic) {
        handlePreparePeriodicCalculationSubmit();
      } else {
        handlePrepareCalculationSubmit();
      }
      return;
    }
    void handleSendMessage(undefined, "CHAT", "GENERAL");
  }

  function handlePrepareCalculationSubmit() {
    if (composerBlockedReason) return;
    const profile: PlanningProfile = generalPlan ? "GENERAL" : "PYSCF_ENERGY_PROPOSAL";
    void handleSendMessage(undefined, "STANDARD", profile);
  }

  function handlePreparePeriodicCalculationSubmit() {
    if (composerBlockedReason) return;
    const msg = prompt.trim() || "Prepare a periodic energy calculation for this crystal structure.";
    void handleSendMessage(msg, "STANDARD", "PERIODIC_ENERGY_PROPOSAL");
  }

  function handleProposeStructureEditSubmit() {
    if (composerBlockedReason) return;
    const msg = prompt.trim() || "Propose a structure edit for this structure.";
    void handleSendMessage(msg, "STANDARD", "STRUCTURE_EDIT_PROPOSAL");
  }

  function handleOpenCalculationPanel() {
    window.dispatchEvent(
      new CustomEvent("chemdft:guided-navigate", {
        detail: { view: "setup", calculationType: "energy" },
      })
    );
  }

  // The planning profile is explicit per request; it is never inferred from the prompt text.
  async function handleSendMessage(messageText?: string, mode: "STANDARD" | "EVIDENCE" | "CHAT" = "CHAT", profile: PlanningProfile = "GENERAL") {
    const text = (messageText ?? prompt).trim();
    if (!text || submittingRef.current || isRunActive || !aiAvailable || !validRunLimits) return;
    if (profile === "PYSCF_ENERGY_PROPOSAL" && !canPrepareCalculation) return;
    if (profile === "PERIODIC_ENERGY_PROPOSAL" && !canPreparePeriodicCalculation) return;
    if (profile === "STRUCTURE_EDIT_PROPOSAL" && !canProposeStructureEdit) return;

    setTurnStarts(old => ({...old, [contextKey]: conversation?.messages?.length ?? 0}));
    const origin = { key: contextKey, label: ctx.label };
    setSubmitOrigin(origin);
    submittingRef.current = true;
    focusAfterSubmissionRef.current = true;
    previousRunRef.current = activeRun?.id;
    setActiveRun(null);
    setStartedAt(Date.now());
    setElapsed(0);
    setSubmitting(true);
    setError(null);
    setPendingQuestion(text);
    setPrompt("");

    // Jump to the bottom immediately on send so the user's new message is visible
    userScrolledAwayRef.current = false;
    window.requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    try {
      const current = conversation ?? await createAiConversation(projectId, { title: "Scientific conversation" });
      const updated = await postAiMessage(projectId, current.conversation.id, aiRunPayload(text, mode, profile, contextHints, limitRun ? runLimits : undefined) as unknown as Parameters<typeof postAiMessage>[2]);
      setConversation(updated);
      setActiveRun(updated.latest_run ?? null);
      const startedRun = updated.latest_run?.id;
      if (startedRun) setRunOrigins((old) => ({ ...old, [startedRun]: origin }));
      setPrompt("");
      setPendingQuestion(null);
    } catch (err) {
      setPendingQuestion(null);
      setPrompt(text);
      setError(err instanceof Error ? err.message : "Failed to send message to AI Scientist.");
    } finally {
      submittingRef.current = false;
      setSubmitOrigin(null);
      setSubmitting(false);
    }
  }

  useEffect(() => {
    sendMessageRef.current = handleSendMessage;
  });

  useEffect(() => {
    function handleComparisonPrompt() {
      setQueuedComparisonPrompt("Summarize the scientific comparison between the paper and ChemDFT.");
    }
    window.addEventListener("chemdft:ai-comparison-summary", handleComparisonPrompt);
    return () => window.removeEventListener("chemdft:ai-comparison-summary", handleComparisonPrompt);
  }, []);

  useEffect(() => {
    if (!queuedComparisonPrompt || loading || isRunActive) return;
    const message = queuedComparisonPrompt;
    const timer = window.setTimeout(() => {
      setQueuedComparisonPrompt(null);
      void sendMessageRef.current(message, "EVIDENCE");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [queuedComparisonPrompt, loading, conversation, isRunActive]);

  async function handleApproval(approvalId: string, decision: Decision, note?: string) {
    if (!conversation || actionLockRef.current) return;
    actionLockRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const updatedRun = await decideAiApproval(projectId, approvalId, {
        decision,
        decision_notes: note ?? (decision === "APPROVE" ? "Approved by user" : "Rejected by user"),
      });
      setActiveRun(updatedRun);
      const updatedConv = await getAiConversation(projectId, conversation.conversation.id);
      setConversation(updatedConv);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record approval decision.");
    } finally {
      actionLockRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleResumeRun() {
    if (!activeRun || !conversation || actionLockRef.current) return;
    actionLockRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const resumed = await resumeAiRun(projectId, activeRun.id);
      setActiveRun(resumed);
      const updatedConv = await getAiConversation(projectId, conversation.conversation.id);
      setConversation(updatedConv);
      void fetchEvents(activeRun.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resume run.");
    } finally {
      actionLockRef.current = false;
      setSubmitting(false);
    }
  }

  async function handlePauseRun() {
    if (!activeRun) return;
    try {
      const paused = await pauseAiRun(projectId, activeRun.id);
      setActiveRun(paused);
      void fetchEvents(activeRun.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pause run.");
    }
  }

  async function handleCancelRun() {
    if (!activeRun) return;
    // Stopping is final and sits where Send usually is, so it asks first.
    if (!window.confirm("Stop this AI run? Its records are kept, but the run cannot be resumed.")) return;
    try {
      const cancelled = await cancelAiRun(projectId, activeRun.id);
      setActiveRun(cancelled);
      void fetchEvents(activeRun.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel run.");
    }
  }

  async function handleClarificationSubmit(replyText: string) {
    if (!replyText.trim() || submitting || !conversationId) return;
    setClarificationInput("");
    await handleSendMessage(replyText.trim(), "STANDARD");
  }

  const latestClarification = useMemo(() => {
    if (!events || events.length === 0) return null;
    // The run that asked ends normally (the question is its answer), so "pending" means no later
    // domain event (a resolved identity or a created draft) has answered it.
    let asked = -1;
    events.forEach((event, index) => { if (event.event_type === "clarification.requested") asked = index; });
    if (asked < 0) return null;
    const answered = events.slice(asked + 1).some((event) => event.event_type === "identity.resolved" || event.event_type === "object.created");
    return answered ? null : events[asked] ?? null;
  }, [events]);

  async function handleCreateInvestigation() {
    const objective = investigationObjective.trim();
    if (!objective || creatingInvestigation) return;
    setCreatingInvestigation(true);
    setError(null);
    try {
      const created = await createInvestigation(projectId, {
        schema_version: "1.0.0",
        title: "Scientific investigation",
        objective,
        policy: {
          max_steps: 10,
          max_calculations: 3,
          max_ai_calls: 10,
          max_elapsed_seconds: 3600,
          max_compute_minor_units: 0,
          allowed_tool_classes: ["read_only", "scientific.expensive"],
          approval_required_for_expensive: true,
        },
      });
      setInvestigation(created);
      setInvestigationObjective("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create investigation.");
    } finally {
      setCreatingInvestigation(false);
    }
  }

  async function handleInvestigationApproval(decision: "APPROVE" | "REJECT") {
    if (!investigation?.pending_approval_id) return;
    try {
      const updated = await decideInvestigationApproval(
        projectId,
        investigation.id,
        investigation.pending_approval_id,
        decision,
      );
      setInvestigation(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to decide investigation approval.");
    }
  }

  async function handleStartInvestigation() {
    if (!investigation) return;
    try {
      setInvestigation(await startInvestigation(projectId, investigation.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start investigation.");
    }
  }

  const isRunWaitingCalculation = activeRun?.status === "WAITING_FOR_CALCULATION";
  const pendingApproval = activeRun?.pending_approval;
  const approvalWaiting = Boolean(pendingApproval && activeRun?.status === "WAITING_FOR_APPROVAL");
  // The paused note replaces the mode description while the composer cannot send.
  const composerPaused = approvalWaiting || isRunPaused || (isRunActive && !submitting);
  // The approval screen opens for every new pending approval; "Conversation" defers only that one.
  const showApprovalScreen = approvalWaiting && deferredApprovalId !== pendingApproval?.id;
  useEffect(() => {
    if (deferredApprovalId && approvalWaiting) reviewButtonRef.current?.focus();
  }, [deferredApprovalId, approvalWaiting]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("chemdft:ai-approval-state", { detail: { pending: approvalWaiting } }));
  }, [approvalWaiting]);
  const allMessages = conversation?.messages ?? [];
  // The researcher's message that started the waiting run: linked by run_id, else the latest user
  // message recorded no later than the run (the request that created it).
  const approvalRequest = useMemo(() => {
    if (!activeRun) return null;
    const runStart = aiTimestamp(activeRun.created_at);
    const users = (conversation?.messages ?? []).filter((message) => message.role === "user");
    const linked = users.filter((message) => message.run_id === activeRun.id).at(-1);
    const prior = users.filter((message) => Number.isFinite(runStart) && aiTimestamp(message.created_at) <= runStart + 1000).at(-1);
    return (linked ?? prior)?.content ?? null;
  }, [activeRun, conversation?.messages]);
  const historyRunIds = [...new Set(allMessages.map((message) => message.run_id).filter((id): id is string => Boolean(id) && id !== activeRun?.id))].slice(-20);
  const historyRunKey = historyRunIds.join("|");
  useEffect(() => {
    const missing = historyRunKey ? historyRunKey.split("|").filter((id) => !historyRuns[id]) : [];
    if (missing.length === 0) return;
    let alive = true;
    void Promise.allSettled(missing.map((id) => getAiRun(projectId, id))).then((results) => {
      if (!alive) return;
      setHistoryRuns((previous) => {
        const next = { ...previous };
        results.forEach((result) => { if (result.status === "fulfilled") next[result.value.id] = result.value; });
        return next;
      });
    });
    return () => { alive = false; };
    // historyRuns is read only to skip runs already loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyRunKey, projectId]);
  const turnStart = turnStarts[contextKey];
  const activeOrigin = activeRun ? runOrigins[activeRun.id] ?? null : submitOrigin;
  const switchedOrigin = (isRunActive || approvalWaiting) && activeOrigin && activeOrigin.key !== contextKey ? activeOrigin : null;
  const { messages, history } = messagesForContext(allMessages, turnStart);
  const isStructureContext = Boolean(
    currentSelection?.projectId === projectId &&
      (currentSelection.kind === "structureVersion" ||
        currentSelection.kind === "optimizedStructureVersion" ||
        currentSelection.kind === "scientificScene")
  );

  const starterPrompts = useMemo(() => {
    if (isCrystalOrPeriodic) {
      return [
        { label: "What am I looking at?", prompt: "What am I looking at?", mode: "CHAT" as const },
        { label: "What can I do next?", prompt: "What can I do next?", mode: "CHAT" as const },
        ...(canPreparePeriodicCalculation
          ? [{ label: "Plan periodic energy", prompt: "Plan a periodic single-point energy calculation for this crystal structure for my review.", mode: "STANDARD" as const, profile: "PERIODIC_ENERGY_PROPOSAL" as const }]
          : [{ label: "Summarize cell & calculations", prompt: "Summarize this periodic crystal structure and its recorded calculations.", mode: "CHAT" as const }]
        ),
      ];
    }
    if (isStructureContext) {
      return [
        { label: "What am I looking at?", prompt: "What am I looking at?", mode: "CHAT" as const },
        { label: "What can I do next?", prompt: "What can I do next?", mode: "CHAT" as const },
        ...(canPrepareCalculation
          ? [{ label: "Plan HF/STO-3G energy", prompt: "Plan an HF/STO-3G single-point energy calculation for this molecule for my review.", mode: "STANDARD" as const, profile: "PYSCF_ENERGY_PROPOSAL" as const }]
          : [{ label: "How many molecules?", prompt: "How many molecules are in this project?", mode: "CHAT" as const }]
        ),
      ];
    }
    return [
      { label: "What am I looking at?", prompt: "What am I looking at?", mode: "CHAT" as const },
      { label: "What can I do next?", prompt: "What can I do next?", mode: "CHAT" as const },
      { label: "Summarize project", prompt: "Summarize this project, its structures, calculations, and imported documents.", mode: "CHAT" as const },
    ];
  }, [isCrystalOrPeriodic, isStructureContext, canPreparePeriodicCalculation, canPrepareCalculation]);

  return (
    <div className={`ai-scientist-panel ai-scientist-redesign-panel ${isExpanded ? "is-expanded" : "is-docked"}`} data-testid="ai-scientist-panel"
      data-context-page={ctx.page} data-context-key={ctx.key} data-grounding={ctx.grounding}
      data-context-result-id={productContext?.selection.selected_result_id ?? ""}
      data-context-view={productContext?.selection.current_view ?? ""}
      data-context-structure-version-id={productContext?.selection.selected_structure_version_id ?? ""}
      data-context-calculation-id={productContext?.resources.find((r) => r.entity_id === productContext.selection.selected_result_id)?.calculation_id ?? ""}>

      {/* Top Header with merged dock navigation */}
      <AIScientistHeader
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        isExpanded={isExpanded}
        onToggleExpand={() => setIsExpanded((prev) => !prev)}
        onClose={() => {
          if (onClose) {
            onClose();
          } else {
            window.dispatchEvent(new CustomEvent("chemdft:toggle-dock"));
            document.querySelector<HTMLButtonElement>('[data-testid="ai-dock-toggle"]')?.focus();
          }
        }}
        evidenceCount={allMessages.reduce((acc, m) => acc + (m.citations?.length ?? 0), 0)}
        approvalPending={approvalWaiting}
        onSelectInspector={onSelectInspector}
        isAdvanced={isAdvanced}
      />

      {/* Interactive Tabs */}
      <div
        role="tabpanel"
        id={`ai-panel-${activeTab}`}
        aria-labelledby={`ai-tab-${activeTab}`}
        className="ai-tabpanel-container"
        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}
      >
        {activeTab === "tools" ? (
          <AIScientistToolsTab
          projectId={projectId}
          allowedTools={productContext?.allowed_tools ?? null}
          aiAvailable={aiAvailable}
          onSelectToolForChat={(_toolName, promptSuggestion) => {
            // Only engine rows that pass the capability + allowed-tool check offer this action.
            setActiveTab("chat");
            setComposerMode("plan");
            setPrompt(promptSuggestion);
            queueMicrotask(() => promptInputRef.current?.focus());
          }}
        />
      ) : activeTab === "evidence" ? (
        <AIScientistEvidenceTab
          projectId={projectId}
          conversationMessages={allMessages}
          onOpenCitation={onCitationClick ?? (() => {})}
        />
      ) : activeTab === "runs" ? (
        <AIScientistRunsTab
          projectId={projectId}
          activeRun={activeRun}
          runs={Object.values(historyRuns)}
          conversationRunCount={historyRunIds.length + (activeRun ? 1 : 0)}
          onOpenChat={() => setActiveTab("chat")}
          onRefresh={() => {
            void refreshRun();
            if (activeRunId) void fetchEvents(activeRunId);
          }}
          onViewResults={(calcId: string) => {
            window.dispatchEvent(
              new CustomEvent("chemdft:guided-navigate", {
                detail: { view: "result", calculationId: calcId },
              })
            );
          }}
        />
      ) : activeTab === "settings" ? (
        <AIScientistSettingsTab
          onModelSaved={() => setSettingsRevision((value) => value + 1)}
        />
      ) : (
        <AIScientistChatTab
          projectId={projectId}
          context={{ ctx, contextKey, effectiveView, currentSelection, productContext, contextError, aiAvailable, aiSettings, activeModelCapability, conformerContext,
            candidateSelection, showFollowAi: ctx.page === "workspace", followAiMode, onFollowAiModeChange: setFollowAiMode, onConfigure: () => setActiveTab("settings"),
            onModelSaved: () => setSettingsRevision((value) => value + 1), switchedOrigin, onCitationClick,
            onRetry: () => setSettingsRevision((value) => value + 1) }}
          run={{ activeRun, activeRunId, events, eventLoading, eventError, runReadError, isRunActive, isRunPaused, isRunWaitingCalculation, waitingComputeJob: waitingCalculationId ? waitingComputeJob : null, submitting, progress, elapsed,
            onResume: handleResumeRun, onCancel: handleCancelRun, onRefreshRun: refreshRun, onFetchEvents: fetchEvents }}
          approval={{ approvalWaiting, pendingApproval, showApprovalScreen, approvalRequest, onDecide: handleApproval, onDefer: setDeferredApprovalId, reviewButtonRef }}
          conversation={{ loading, scrollRef, allMessages, messages, history, turnStart, runOrigins, submitOrigin, pendingQuestion, starterPrompts, latestClarification,
            onStarter: (starter) => {
              // Starters fill the composer so the researcher can edit before sending.
              setComposerMode("profile" in starter ? "plan" : "ask");
              setPrompt(starter.prompt);
              queueMicrotask(() => promptInputRef.current?.focus());
            },
            clarificationInput, onClarificationInputChange: setClarificationInput, onClarificationSubmit: handleClarificationSubmit,
            planAwaitingChoice, composerRequestMode, composerProfile, onSend: handleSendMessage }}
          investigation={{ investigation, objective: investigationObjective, onObjectiveChange: setInvestigationObjective, creating: creatingInvestigation,
            onCreate: handleCreateInvestigation, onStart: handleStartInvestigation, onDecide: handleInvestigationApproval }}
          isCrystalOrPeriodic={isCrystalOrPeriodic}
          composer={(
            <AIScientistComposer
              mode={composerMode} onModeChange={setComposerMode}
              prompt={prompt} onPromptChange={setPrompt} inputRef={promptInputRef}
              onSubmit={handleAskSubmit}
              onPrepareCalculation={handlePrepareCalculationSubmit}
              onPreparePeriodicCalculation={handlePreparePeriodicCalculationSubmit}
              onProposeStructureEdit={handleProposeStructureEditSubmit}
              onOpenCalculationPanel={handleOpenCalculationPanel}
              canPrepareCalculation={canPrepareCalculation}
              canPreparePeriodicCalculation={canPreparePeriodicCalculation}
              canProposeStructureEdit={canProposeStructureEdit}
              isCrystalOrPeriodic={isCrystalOrPeriodic}
              proposalReasons={proposalReasons}
              aiAvailable={aiAvailable} submitting={submitting}
              run={{ approvalWaiting, composerPaused, isRunActive, isRunPaused, waitingForCalculation: activeRun?.status === "WAITING_FOR_CALCULATION",
                onPause: () => void handlePauseRun(), onResume: () => void handleResumeRun(), onStop: () => void handleCancelRun() }}
              planning={{ planNeedsVersion, planAwaitingChoice, energyPlanningReady, candidateSelection, savedVersions, planningVersionLabel, planningVersionChosenByServer,
                effectiveView, blockedReason: composerBlockedReason, generalPlan, onGeneralPlanChange: setGeneralPlan,
                onUseVersion: (item) => {
                  window.dispatchEvent(new CustomEvent("chemdft:open-ai-scientist", { detail: { keepForSelectionId: item.selection.id } }));
                  workspace?.openSelection(item.selection, item.label);
                } }}
              limits={{ limitRun, onLimitRunChange: setLimitRun, values: runLimitValues, onValuesChange: setRunLimitValues, valid: validRunLimits }}
              error={error} onRefreshStatus={() => { if (activeRunId) void refreshRun(); else void loadConversation(); }} />
          )} />
      )}
      </div>
    </div>
  );
}
