# ruff: noqa: E501, RUF001
"""DRAW mode orchestration: authorize, reserve budget, ask the model for ops, apply with RDKit.

Mixed into ``AIScientistService`` so it shares the exact reservation, settlement, usage-record and
provider-binding path of the other AI modes. At most two model calls per request (the original and
one repair); the drawing is never saved here.
"""

from __future__ import annotations

from uuid import UUID

from rdkit import Chem
from sqlalchemy import select

from ..actions import authorize_project_access
from ..ai_models import AIContextSnapshotRecord, AIConversationRecord, AIMessageRecord, AIRunRecord
from ..contracts.ai import (
    DrawClarify,
    DrawClarifyOption,
    DrawFinal,
    DrawInput,
    DrawProposal,
    DrawReferenceCheck,
    DrawResponse,
    DrawStepView,
)
from ..contracts.ai_foundation import ProductSelection
from ..errors import ScientificReferenceNotFound
from ..models import new_id
from ..project_access import ProjectCapability, require_capability
from .budgets import AIBudgetExceededError
from .draw import (
    DRAW_POLICY,
    DRAW_POLICY_VERSION,
    DRAW_REPLY_NOTE,
    MAX_COPIES,
    NAME_CAUTION,
    REFERENCE_NOTE,
    REFUSAL_REPLY,
    SMALL_TALK_REPLY,
    ClearAll,
    DrawState,
    ModelPlan,
    PlanRejected,
    StepError,
    StepResult,
    ambiguous_follow_up,
    answer_drawing_question,
    asks_for_property,
    build_repair_message,
    build_user_message,
    claims_connected,
    formula_of,
    integrity_problems,
    is_clear_request,
    is_question,
    is_small_talk,
    option_inapplicable,
    parse_plan,
    parse_stated_counts,
    requested_molecule_count,
    requested_total_molecules,
    run_ops,
    safe_reply,
    single_molecule_requested,
    too_many_copies_reply,
    truncate_history,
    unknown_name_reply,
    unmappable_subject,
    verify_counts,
)
from .draw_known import (
    KNOWN,
    KnownMolecule,
    claimed_molecule,
    requested_copies,
    requested_molecule,
    verify_copies,
    verify_known,
)
from .gateway import ModelMessage, ModelRequest, ModelTier
from .observability import emit
from .policy import SYSTEM_POLICY_V1
from .product_context import ProductContextBuilder
from .providers import AIFoundationError

_DRAW_OUTPUT_LIMIT = 2048
TABLE_NAMES_NOTE = (
    "Names that add_copies accepts directly as source (everything else needs load_smiles first): "
    + ", ".join(sorted({entry.name for entry in KNOWN}))
    + "."
)


def _describe(step: StepResult) -> str:
    op = step.op
    name = str(op.get("op"))
    target = op.get("attach_to")
    tail = f" on atom {target}" if target else ""
    match name:
        case "add_atom":
            count = op.get("count", 1)
            return f"Add {count} × {op.get('element')}{tail}"
        case "add_bond":
            return f"Bond atoms {op.get('a')}–{op.get('b')} (order {op.get('order', 1)})"
        case "add_ring":
            kind = "aromatic ring" if op.get("aromatic") else "ring"
            return f"Add a {op.get('size')}-membered {kind}{tail}"
        case "add_group":
            return f"Add {op.get('name')} on atom {op.get('attach_to')}"
        case "set_charge":
            return f"Set charge of atom {op.get('atom')} to {op.get('value'):+d}"
        case "set_element":
            return f"Change atom {op.get('atom')} to {op.get('element')}"
        case "delete":
            return f"Delete atom {op['atom']}" if "atom" in op else f"Delete bond {op.get('bond')}"
        case "connect_fragments":
            return f"Connect atoms {op.get('a')} and {op.get('b')}"
        case "load_smiles":
            return f"Load proposed structure for '{op.get('label')}'"
        case "add_copies":
            return f"Add {op.get('count')} × {op.get('source')} in a {op.get('layout', 'grid')}"
        case "clear_all":
            return "Clear the drawing"
        case "clean_up":
            return "Clean up the layout"
        case "undo_last":
            return "Undo the last AI change"
    return name


def _step_view(step: StepResult) -> DrawStepView:
    return DrawStepView(
        index=step.index,
        op=step.op,  # type: ignore[arg-type]
        ok=step.ok,
        error=step.error,
        suggestion=step.suggestion,
        molfile=step.molfile,
        smiles=step.smiles,
        formula=step.formula,
        new_atom_numbers=tuple(step.new_atom_numbers),
        atom_count=step.atom_count,
        description=_describe(step),
    )


class DrawServiceMixin:
    """Expects the AIScientistService attributes and helpers it is mixed into."""

    def draw(self, project_id: str, conversation_id: str, payload: DrawInput) -> DrawResponse:
        project, member = authorize_project_access(self._session, self._identity, project_id)
        require_capability(member, ProjectCapability.READ)
        from ..usage_limits import enforce_ai_run_limit

        enforce_ai_run_limit(self._session, self._settings, self._identity.user_id)
        from ..account_policy import enforce_ai

        enforce_ai(self._session, self._settings, self._identity.user_id)

        conversation = self._session.scalar(
            select(AIConversationRecord).where(
                AIConversationRecord.id == conversation_id,
                AIConversationRecord.project_id == project.id,
                AIConversationRecord.created_by == self._identity.user_id,
            )
        )
        if conversation is None:
            raise ScientificReferenceNotFound("Conversation does not exist.")

        try:
            state = DrawState.from_molfile(payload.molfile)
            if payload.previous_molfile:
                DrawState.from_molfile(payload.previous_molfile)
        except StepError as err:
            raise AIFoundationError("DRAW_DRAWING_INVALID", str(err), 422) from err

        def add_message(role: str, content: str, run_id: str | None = None) -> None:
            self._session.add(
                AIMessageRecord(
                    id=new_id(),
                    project_id=project.id,
                    conversation_id=conversation.id,
                    run_id=run_id,
                    role=role,
                    content=content,
                    citations_json=[],
                    evidence_refs_json=[],
                    evidence_status=None,
                    evidence_note=DRAW_REPLY_NOTE if role == "assistant" else None,
                )
            )

        # A property / energy / citation request never reaches the model and costs nothing.
        if is_small_talk(payload.content):
            add_message("user", payload.content)
            add_message("assistant", SMALL_TALK_REPLY)
            self._session.commit()
            return DrawResponse(status="NO_CHANGE", reply=SMALL_TALK_REPLY)

        if asks_for_property(payload.content):
            add_message("user", payload.content)
            add_message("assistant", REFUSAL_REPLY)
            self._session.commit()
            return DrawResponse(status="REFUSED", reply=REFUSAL_REPLY)

        local = self._draw_local_answer(payload, state)
        if isinstance(local, DrawInput):
            payload = (
                local  # a bare follow-up with a single applicable reading runs as that request
            )
        elif local is not None:
            add_message("user", payload.content)
            add_message("assistant", local.reply)
            self._session.commit()
            return local

        self._product_context = ProductContextBuilder(
            self._session, self._identity, self._settings, self._registry
        ).build(project.id, ProductSelection())
        if not self._product_context.ai.available:
            raise AIFoundationError(
                self._product_context.ai.error_code or "AI_UNAVAILABLE",
                "The selected AI mode/provider is unavailable. "
                "Core workflows remain available; configure AI settings.",
                503,
            )
        ai_state = self._product_context.ai
        self._providers.pin(ai_state.mode, ai_state.provider, ai_state.model)
        self._providers.profile_gate("EVIDENCE")

        snapshot = AIContextSnapshotRecord(
            id=new_id(),
            project_id=project.id,
            schema_version=f"product-context/{self._product_context.context_version}",
            summary=self._product_context.model_dump_json(),
            captured_entity_refs_json=[],
        )
        self._session.add(snapshot)
        self._session.flush()
        emit(
            "ai.request.started",
            human_id=self._identity.user_id,
            organization_id=self._identity.organization_id,
            project_id=project.id,
            provider=ai_state.provider,
            model=ai_state.model,
            mode="DRAW",
            context_bytes=len(payload.molfile or ""),
        )
        add_message("user", payload.content)
        run = AIRunRecord(
            id=new_id(),
            project_id=project.id,
            conversation_id=conversation.id,
            actor_id=self._identity.user_id,
            status="PLANNING",
            context_snapshot_id=snapshot.id,
            current_step=0,
            max_steps=2,
            budget_json=None,
        )
        self._session.add(run)
        self._session.commit()

        try:
            response = self._execute_draw_run(project.id, run, payload, state)
        except AIFoundationError as error:
            self._fail_run_fenced(project.id, run, error.code, error.detail)
            response = DrawResponse(
                status="ERROR",
                reply=error.detail,
                error_code=error.code,
                error=error.detail,
                run_id=UUID(run.id),
            )
        add_message("assistant", response.reply, run.id)
        self._session.commit()
        emit(
            "ai.request.completed",
            human_id=self._identity.user_id,
            project_id=project.id,
            run_id=run.id,
            provider=ai_state.provider,
            model=ai_state.model,
            status=run.status,
            error_code=run.error_code,
            draw_status=response.status,
            draw_steps=len(response.steps),
        )
        return response

    # ------------------------------------------------------------------------------------------

    def _draw_local_answer(
        self, payload: DrawInput, state: DrawState
    ) -> DrawResponse | DrawInput | None:
        """Requests the server can answer exactly, with no model call and no cost."""
        if is_clear_request(payload.content):
            if state.mol.GetNumAtoms() == 0:
                return DrawResponse(status="NO_CHANGE", reply="The drawing is already empty.")
            outcome = run_ops(state, [ClearAll(op="clear_all")], previous_molfile=None)
            step = outcome.steps[0]
            return DrawResponse(
                status="OK",
                reply="Cleared the drawing.",
                steps=(_step_view(step),),
                final=DrawFinal(molfile=step.molfile or "", smiles="", formula="", atom_count=0),
                warnings=("Cleared by a typed command; use Undo all to bring the drawing back.",),
            )
        answer = answer_drawing_question(payload.content, state.mol)
        if answer is not None:
            return DrawResponse(status="NO_CHANGE", reply=answer)
        copies = requested_copies(payload.content)
        if copies is not None and copies[1] > MAX_COPIES:
            return DrawResponse(status="NO_CHANGE", reply=too_many_copies_reply(copies[1]))
        follow_up = ambiguous_follow_up(
            payload.content,
            state.smiles() if len(Chem.GetMolFrags(state.mol)) == 1 else "",
            state.mol,
        )
        if follow_up is not None:
            question, options = follow_up
            if len(options) == 1:
                # Only one reading applies to this drawing: no question to ask, run it as the request.
                return payload.model_copy(update={"content": options[0][1]})
            return DrawResponse(
                status="CLARIFY",
                reply=question,
                clarify=DrawClarify(
                    question=question,
                    options=tuple(DrawClarifyOption(label=a, message=b) for a, b in options),
                ),
            )
        subject = unmappable_subject(payload.content)
        if subject is not None:
            return DrawResponse(status="NO_CHANGE", reply=unknown_name_reply(subject))
        return None

    def _draw_model_call(
        self, project_id: str, run: AIRunRecord, request: ModelRequest
    ) -> tuple[str, int, int]:
        """One reserved, settled, recorded model call. Returns (content, tokens in, tokens out)."""
        limit = min(max(self._settings.ai_max_tokens_per_run, 1), _DRAW_OUTPUT_LIMIT)
        try:
            reserved, request = self._reserve_model_request(
                project_id, run.id, None, request, limit
            )
        except AIBudgetExceededError as err:
            raise AIFoundationError(err.code, f"Drawing assistant unavailable: {err}", 409) from err
        self._usage_run_id = run.id
        self._usage_reservation_id = reserved.reservation_id
        self._usage_prompt_version = DRAW_POLICY_VERSION
        try:
            response = self._generate(request)
            self._record_model_usage(project_id, run.id, response, DRAW_POLICY_VERSION)
        except Exception:
            self._execution_manager.settle_uncertain_usage(
                project_id, run.id, reservation_id=self._usage_reservation_id
            )
            raise
        tokens_in = tokens_out = 0
        if response.usage is not None:
            tokens_in, tokens_out = response.usage.input_tokens, response.usage.output_tokens
            self._execution_manager.settle_model_usage(
                project_id,
                run.id,
                tokens_in,
                tokens_out,
                reservation_id=self._usage_reservation_id,
            )
        else:
            self._execution_manager.settle_uncertain_usage(
                project_id, run.id, reservation_id=self._usage_reservation_id
            )
        return response.content or "", tokens_in, tokens_out

    def _execute_draw_run(
        self, project_id: str, run: AIRunRecord, payload: DrawInput, state: DrawState
    ) -> DrawResponse:
        history = [
            ModelMessage(role=role, content=text)
            for role, text in truncate_history([(t.role, t.content) for t in payload.history])
        ]
        initial_mol = Chem.Mol(state.mol)
        stated = parse_stated_counts(payload.content, drawing_is_empty=state.mol.GetNumAtoms() == 0)
        copies = requested_copies(payload.content)
        if copies is not None:
            stated = (
                None  # "6 carbon dioxide" is not "6 carbon atoms": the copies check owns the count
            )
        run.current_step, run.max_steps = 1, 2
        self._session.commit()

        steps: list[StepResult] = []
        proposals: list[dict[str, str]] = []
        tokens_in = tokens_out = 0
        repaired = False
        problem: str | None = None
        previous = payload.previous_molfile
        user_text = build_user_message(state.summary(), payload.content)
        plan: ModelPlan | None = None
        any_plan: ModelPlan | None = None
        mismatch: str | None = None
        mismatch_kind = "counts"
        known = requested_molecule(payload.content)
        if copies is not None and known is None and copies[1] == 1 and state.mol.GetNumAtoms() == 0:
            known = copies[0]
        expected_fragments = (
            copies[1]
            if copies is not None
            else 1
            if known is not None or (stated is not None and stated.closed)
            else None
        )
        generic_count = (
            requested_molecule_count(payload.content)
            if copies is None and initial_mol.GetNumAtoms() == 0
            else None
        )
        if expected_fragments is None and generic_count:
            expected_fragments = generic_count
            stated = None  # "3 pyridine molecules" is a molecule count, not 3 atoms of an element
        if expected_fragments is None and single_molecule_requested(
            payload.content, drawing_is_empty=initial_mol.GetNumAtoms() == 0
        ):
            expected_fragments = 1
        total_requested = requested_total_molecules(payload.content)
        if expected_fragments is None and total_requested:
            expected_fragments = total_requested  # "... has 2 molecules in total"
        attempt = 0
        while True:
            attempt += 1
            request = ModelRequest(
                system_prompt=f"{SYSTEM_POLICY_V1}\n\n{DRAW_POLICY}\n\n{TABLE_NAMES_NOTE}",
                messages=(*history, ModelMessage(role="user", content=user_text)),
                tools=(),
                model_tier=ModelTier.STANDARD,
                temperature=0.0,
                direct_answer=True,
            )
            content, t_in, t_out = self._draw_model_call(project_id, run, request)
            tokens_in += t_in
            tokens_out += t_out
            problem = None
            mismatch = None
            mismatch_kind = "counts"
            try:
                plan = parse_plan(content)
            except PlanRejected as err:
                plan, problem = None, str(err)
                prose = (content or "").strip()
                if is_question(payload.content) and prose and not prose.lstrip().startswith("{"):
                    # A question the model answered in plain words instead of JSON: that is an answer, not an
                    # invalid plan. It passes the same reply filter as any other model sentence.
                    plan = ModelPlan(ops=[], reply=" ".join(prose.split())[:600], clarify=None)
                    problem = None
            if plan is not None:
                any_plan = plan
            # "chain", "connected", "one molecule" in the request or in the model's own sentence is a claim
            # the server verifies: the result may not have more fragments than the drawing had.
            effective_expected = expected_fragments
            if effective_expected is None and (
                claims_connected(payload.content)
                or (plan is not None and claims_connected(plan.reply))
            ):
                effective_expected = max(1, len(Chem.GetMolFrags(initial_mol)))
            clarify_options = []
            if plan is not None and plan.clarify is not None:
                # Option messages become the next request, so each must restate the same counts.
                clarify_options = [
                    o
                    for o in plan.clarify.options
                    if option_inapplicable(o.message, state.mol) is None
                    and (
                        stated is None
                        or (
                            (again := parse_stated_counts(o.message, drawing_is_empty=stated.total))
                            is not None
                            and again.counts == stated.counts
                        )
                    )
                ]
                if len(clarify_options) >= 2:
                    return self._draw_done(
                        run, "CLARIFY", plan.clarify.question, repaired, tokens_in, tokens_out,
                        clarify=DrawClarify(
                            question=plan.clarify.question,
                            options=tuple(
                                DrawClarifyOption(label=o.label, message=o.message)
                                for o in clarify_options
                            ),
                        ),
                    )  # fmt: skip
                problem = (
                    "Every clarify option 'message' must restate the researcher's exact atom "
                    "counts and must be applicable to the CURRENT drawing (no carbon chain for a "
                    "drawing without carbon); at least two options must do so."
                )
                plan = ModelPlan(ops=[], reply="", clarify=None)
            if problem is None and plan is not None and not plan.ops and stated is not None:
                problem = (
                    "The researcher stated atom counts. Draw a structure with exactly those "
                    "counts, or ask which structure they mean with 'clarify' and 2-4 options."
                )
            elif plan is not None and problem is None:
                outcome = run_ops(
                    state, list(plan.ops), previous_molfile=previous, start_index=len(steps)
                )
                steps.extend(outcome.steps)
                proposals.extend(outcome.proposals)
                if outcome.stopped_at is not None:
                    failed = steps[-1]
                    problem = f"Step {failed.index + 1} failed: {failed.error}"
                elif (
                    any(x.ok for x in steps)
                    and known is not None
                    and (reference_error := verify_known(known, state.mol))
                ):
                    mismatch = reference_error
                    mismatch_kind = "reference"
                    problem = (
                        f"Reference check failed: {reference_error}. The reference structure of "
                        f"{known.name} is SMILES {known.smiles}; use one load_smiles op with "
                        "replace=true or fix the drawing."
                    )
                elif (
                    stated is not None
                    and any(x.ok for x in steps)
                    and (mismatch := verify_counts(stated, initial_mol, state.mol))
                ):
                    mismatch_kind = "counts"
                    problem = (
                        f"The drawing does not match the stated counts ({mismatch}). Counts "
                        "include hydrogens implied by valence: an atom without bonds gets "
                        "implicit hydrogens. Do not delete everything; connect the atoms into "
                        "one structure, or use 'clarify' when several structures fit."
                    )
                elif any(x.ok for x in steps):
                    findings = integrity_problems(state.mol, expected_fragments=effective_expected)
                    if copies is not None and (
                        copy_error := verify_copies(copies[0], copies[1], state.mol)
                    ):
                        findings.append(copy_error)
                    said = claimed_molecule(plan.reply) if copies is None else None
                    if said is not None and (reference_error := verify_known(said, state.mol)):
                        findings.append(f"the reply says {said.name} but {reference_error}")
                    if findings:
                        mismatch = "; ".join(findings)
                        mismatch_kind = "integrity"
                        problem = (
                            f"The server checked the finished drawing and found: {mismatch}. "
                            "For several copies of one molecule use ONE add_copies op; to start "
                            "over use clear_all first, then the corrected ops. Do not bond "
                            "separate molecules together."
                        )
            if problem is None or attempt >= 2:
                break
            repaired = True
            if steps and not steps[-1].ok:
                steps.pop()  # the failed step is replaced by the repair, never shown as applied
            user_text = build_repair_message(state.summary(), payload.content, problem)

        reply_fallback = ""
        if problem is not None and plan is None and not any(s.ok for s in steps):
            return self._draw_done(
                run, "REJECTED", "I could not turn that into a valid drawing plan. Nothing was "
                "changed; try rephrasing.", repaired, tokens_in, tokens_out,
                error=problem,
            )  # fmt: skip
        plan = plan or any_plan
        assert plan is not None
        ok_steps = [s for s in steps if s.ok]
        if mismatch and mismatch_kind == "reference":
            return self._draw_done(
                run, "REJECTED",
                f"Nothing was changed: {mismatch}.",
                repaired, tokens_in, tokens_out, error=problem,
            )  # fmt: skip
        if mismatch and mismatch_kind == "integrity":
            # The model's own sentence is never shown here: the server's findings decide the wording.
            return self._draw_done(
                run, "NEEDS_ATTENTION",
                f"Needs attention, not done: {mismatch}. The steps are shown so you can "
                "inspect them; use Undo all, or rephrase the request.",
                repaired, tokens_in, tokens_out,
                steps=steps, proposals=proposals, error=problem, state=state,
            )  # fmt: skip
        if mismatch:
            return self._draw_done(
                run, "REJECTED",
                f"Nothing was changed: the drawing would not match the numbers you gave ({mismatch}).",
                repaired, tokens_in, tokens_out, error=problem,
            )  # fmt: skip
        if not steps:
            reply = safe_reply(plan.reply, "No change was made to the drawing.")
            return self._draw_done(run, "NO_CHANGE", reply, repaired, tokens_in, tokens_out)
        failed_step = next((s for s in steps if not s.ok), None)
        if failed_step is not None:
            kept = len(ok_steps)
            reply = (
                f"Stopped at step {failed_step.index + 1}: {failed_step.error} "
                + (f"{failed_step.suggestion} " if failed_step.suggestion else "")
                + (
                    f"The {kept} earlier step(s) are valid and were kept."
                    if kept
                    else "Nothing was changed."
                )
            ).strip()
            status = "PARTIAL" if kept else "REJECTED"
            return self._draw_done(
                run, status, reply, repaired, tokens_in, tokens_out,
                steps=steps, proposals=proposals, error=failed_step.error, state=state,
            )  # fmt: skip
        reply_fallback = f"Applied {len(ok_steps)} step(s). The drawing is schematic."
        reply = safe_reply(plan.reply, reply_fallback)
        return self._draw_done(
            run, "OK", reply, repaired, tokens_in, tokens_out,
            steps=steps, proposals=proposals, state=state,
            reference=(copies[0] if copies is not None else known) if any(s.ok for s in steps) else None,
            expected_fragments=effective_expected
            if copies is not None or generic_count or total_requested
            else None,
        )  # fmt: skip

    def _draw_done(
        self,
        run: AIRunRecord,
        status: str,
        reply: str,
        repaired: bool,
        tokens_in: int,
        tokens_out: int,
        *,
        steps: list[StepResult] | None = None,
        proposals: list[dict[str, str]] | None = None,
        clarify: DrawClarify | None = None,
        error: str | None = None,
        state: DrawState | None = None,
        reference: KnownMolecule | None = None,
        expected_fragments: int | None = None,
    ) -> DrawResponse:
        run.status = "SUCCEEDED"
        run.error_code = None
        self._session.commit()
        views = tuple(_step_view(s) for s in (steps or []))
        applied = [s for s in (steps or []) if s.ok]
        final = None
        warnings: list[str] = []
        info: list[str] = []
        if applied and state is not None:
            last = applied[-1]
            final = DrawFinal(
                molfile=last.molfile or "",
                smiles=last.smiles or "",
                formula=last.formula or "",
                atom_count=last.atom_count,
            )
            fragments = len(Chem.GetMolFrags(state.mol)) if state.mol.GetNumAtoms() else 0
            if fragments > 1 and fragments == expected_fragments:
                info.append(f"{fragments} molecules")  # asked for, so not a warning
            elif fragments > 1:
                warnings.append(f"The drawing has {fragments} separate fragments.")
            if sum(a.GetFormalCharge() for a in state.mol.GetAtoms()):
                warnings.append("The drawing has a net charge.")
        reference_check = None
        if reference is not None and applied:
            reference_check = DrawReferenceCheck(
                name=reference.name,
                formula=formula_of(Chem.MolFromSmiles(reference.smiles)),
                note=REFERENCE_NOTE.format(name=reference.name),
            )
            names = {reference.name, *reference.synonyms}
            proposals = [p for p in (proposals or []) if p["label"].lower() not in names]
            warnings.append(reference_check.note)
        else:
            for proposal in proposals or []:
                warnings.append(proposal["note"])
            if applied:
                warnings.append(NAME_CAUTION)
        return DrawResponse(
            status=status,  # type: ignore[arg-type]
            reply=reply,
            steps=views,
            final=final,
            clarify=clarify,
            reference_check=reference_check,
            proposals=tuple(DrawProposal(**p) for p in (proposals or [])),
            warnings=tuple(warnings),
            info=tuple(info),
            error=error,
            repaired=repaired,
            run_id=UUID(run.id),
            model=self._product_context.ai.model if self._product_context else None,
            input_tokens=tokens_in,
            output_tokens=tokens_out,
        )
