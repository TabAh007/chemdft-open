"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { StructureVersionDetail, VibrationalAnalysis } from "@chemdft/schemas";
import { getCalculation, getStructureVersion } from "@/lib/structure-workspace-api";
import {
  ENERGY_UNITS,
  STANDARD_ATMOSPHERE_PA,
  TREND_QUANTITIES,
  conditionsLabel,
  energyFactor,
  evaluateRrho,
  familyOf,
  formatEnergy,
  formatPerKelvin,
  formatPressure,
  formatTemperature,
  isPerKelvin,
  modelFromResult,
  perKelvinFactor,
  perKelvinUnit,
  preferredRecord,
  resolveConditionsDraft,
  sameConditions,
  sampleTrend,
  trendValue,
  unitFactors,
  viewFromResult,
  type EnergyUnit,
  type ThermoConditions,
  type ThermoRecord,
  type TrendQuantity,
} from "@/lib/thermochemistry";
import { compactStructureTitle } from "@/lib/structure-workbench";
import { DEFAULT_VISUAL_EXAGGERATION, MAX_VISUAL_EXAGGERATION, MIN_VISUAL_EXAGGERATION } from "@/lib/vibrational-mode";
import { ContributionBar, EntropyDonut, TrendChart } from "./thermochemistry-charts";
import { ThermochemistryViewer } from "./thermochemistry-viewer";
import { SegmentedToggle, SpectroscopyHeader } from "./spectroscopy-shell";

export interface ThermochemistryConditionRequest {
  frequencyResultId: string;
  structureVersionId: string;
  temperatureK: number;
  pressurePa: number;
}

export interface ThermochemistryPanelProps {
  projectId: string;
  records: ThermoRecord[];
  selectedResultId?: string | null | undefined;
  onSelectResult?: ((resultId: string) => void) | undefined;
  onRequestConditions?: ((request: ThermochemistryConditionRequest) => Promise<{ error?: string }>) | undefined;
  structureName?: string | undefined;
  active?: boolean | undefined;
  onSwitchToAdvanced?: (() => void) | undefined;
}

const SHORT = (id: string) => id.slice(0, 8);

/** Text being edited, plus the last conditions that validated (what the page actually shows). */
interface ThermoDraft {
  key: string;
  temperature: string;
  pressure: string;
  valid: ThermoConditions;
}

const atmText = (pressurePa: number) => String(Number((pressurePa / STANDARD_ATMOSPHERE_PA).toPrecision(6)));

export function ThermochemistryPanel({
  projectId,
  records,
  selectedResultId,
  onSelectResult,
  onRequestConditions,
  structureName,
  active = true,
  onSwitchToAdvanced,
}: ThermochemistryPanelProps) {
  const selectedRecord = useMemo(
    () => records.find((record) => record.resultId === selectedResultId) ?? preferredRecord(records),
    [records, selectedResultId],
  );
  const payload = selectedRecord?.payload ?? null;
  const family = useMemo(
    () => (payload ? familyOf(records, payload.frequency_result_id) : []),
    [records, payload],
  );
  const baseKey = selectedRecord?.resultId ?? "none";

  // --- conditions -------------------------------------------------------------------------------
  // Temperature/pressure text is DRAFT input. Only a valid draft becomes the displayed conditions;
  // an invalid draft keeps the last valid conditions on screen (clearly labelled) and never
  // recomputes a preview or creates a calculation. Stored records remain the authority.
  const baseConditions: ThermoConditions = payload
    ? { temperatureK: payload.conditions.temperature_k, pressurePa: payload.conditions.pressure_pa }
    : { temperatureK: 298.15, pressurePa: STANDARD_ATMOSPHERE_PA };
  const [draftState, setDraftState] = useState<ThermoDraft | null>(null);
  const draft = draftState && draftState.key === baseKey ? draftState : null; // reset when the record changes
  const temperatureInput = draft?.temperature ?? String(baseConditions.temperatureK);
  const pressureInput = draft?.pressure ?? atmText(baseConditions.pressurePa);
  const lastValid = draft?.valid ?? baseConditions;
  const { temperatureK, pressurePa } = lastValid;

  const draftTemperatureK = Number(temperatureInput);
  const { error: validation, invalidFields } = resolveConditionsDraft(temperatureInput, pressureInput, lastValid);
  const matching = family.find((record) =>
    sameConditions({ temperatureK: record.payload.conditions.temperature_k, pressurePa: record.payload.conditions.pressure_pa }, { temperatureK, pressurePa }),
  );

  function updateDraft(temperature: string, pressure: string) {
    const outcome = resolveConditionsDraft(temperature, pressure, lastValid);
    setDraftState({ key: baseKey, temperature, pressure, valid: outcome.conditions });
    setRequest({ state: "idle" });
  }

  const model = useMemo(() => (payload ? modelFromResult(payload) : null), [payload]);
  const view = useMemo(() => {
    if (!payload || !model) return null;
    if (matching) return viewFromResult(matching.payload);
    return evaluateRrho(model, temperatureK, pressurePa, payload.diagnostics.low_frequency_threshold_cm1);
  }, [payload, model, matching, temperatureK, pressurePa]);
  const activePayload = matching?.payload ?? payload;

  // --- units ------------------------------------------------------------------------------------
  const [unit, setUnit] = useState<EnergyUnit>("kJ/mol");
  const factors = useMemo(() => (payload ? unitFactors(payload.constants) : null), [payload]);

  // --- source structure + normal modes (persisted source frequency result) -----------------------
  const sourceKey = payload ? `${payload.input_structure_version_id}:${payload.frequency_calculation_id}` : "";
  const [loaded, setLoaded] = useState<{
    key: string;
    source: StructureVersionDetail | null;
    analysis: VibrationalAnalysis | null;
  }>({ key: "", source: null, analysis: null });
  useEffect(() => {
    if (!payload) return;
    let alive = true;
    const key = sourceKey;
    void getStructureVersion({
      projectId,
      structureId: payload.input_structure_id,
      versionId: payload.input_structure_version_id,
    })
      .then((detail) =>
        alive && setLoaded((prev) => ({ key, source: detail, analysis: prev.key === key ? prev.analysis : null })),
      )
      .catch(() => undefined);
    void getCalculation({ projectId, calculationId: payload.frequency_calculation_id })
      .then((detail) => {
        if (alive && detail.result?.result_type === "chemdft.vibrational-analysis") {
          const analysisPayload = detail.result.payload as VibrationalAnalysis;
          setLoaded((prev) => ({ key, source: prev.key === key ? prev.source : null, analysis: analysisPayload }));
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [projectId, sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const source = loaded.key === sourceKey ? loaded.source : null;
  const analysis = loaded.key === sourceKey ? loaded.analysis : null;

  // --- mode selection / animation -----------------------------------------------------------------
  const [selectedMode, setSelectedMode] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false); // nothing autoplays on page load
  const [exaggeration, setExaggeration] = useState(DEFAULT_VISUAL_EXAGGERATION);
  const speed = 1;
  function chooseMode(index: number) {
    setSelectedMode(index);
    setPlaying(true);
  }
  const [trendQuantity, setTrendQuantity] = useState<TrendQuantity>("gibbs-correction");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  // --- authoritative request for new conditions -----------------------------------------------------
  const [request, setRequest] = useState<{ state: "idle" | "pending" | "error"; message?: string }>({ state: "idle" });

  // --- AI Scientist context (deterministic grounding) -----------------------------------------------
  useEffect(() => {
    if (!active || !activePayload || !view) return;
    const prefix = source ? compactStructureTitle(source.structure.name, source.version.revision) : (structureName ?? "Structure");
    const label = `${prefix} → Thermochemistry · ${conditionsLabel(view.temperatureK, view.pressurePa)} · ${activePayload.method.toUpperCase()} / ${activePayload.basis}`;
    window.dispatchEvent(
      new CustomEvent("chemdft:workspace-selection", {
        detail: {
          projectId,
          calculationId: matching?.calculationId ?? selectedRecord?.calculationId ?? "",
          resultId: matching?.resultId ?? selectedRecord?.resultId ?? "",
          structureName: source?.structure.name,
          structureVersionRevision: source?.version.revision,
          currentView: label,
          thermochemistryTemperatureK: view.temperatureK,
          thermochemistryPressurePa: view.pressurePa,
          thermochemistryOrigin: view.origin,
          selectedModeIndex: selectedMode ?? undefined,
        },
      }),
    );
  }, [active, activePayload, view, matching, selectedRecord, projectId, source, structureName, selectedMode]);

  if (!payload || !selectedRecord || !view || !factors || !model) return null;

  const perK = perKelvinUnit(unit);
  const energy = (valueEh: number) => formatEnergy(valueEh, unit, factors);
  const perKelvin = (valueEhK: number) => formatPerKelvin(valueEhK, unit, factors);
  const isPreview = view.origin === "preview";
  const pressureAtm = view.pressurePa / STANDARD_ATMOSPHERE_PA;
  const warnings = activePayload?.diagnostics.warnings ?? [];
  const lowModes = view.modes.filter((mode) => mode.lowFrequency);

  // contributions (energy bars separate E0 from the thermal terms)
  const thermalTerms = [
    { id: "zpe", label: "Zero-point energy (ZPE)", value: view.zpe, color: "#0f766e" },
    { id: "vibrational", label: "Vibrational (thermal)", value: view.components.vibrational.energy - view.zpe, color: "#d97706" },
    { id: "translational", label: "Translational", value: view.components.translational.energy, color: "#0284c7" },
    { id: "rotational", label: "Rotational", value: view.components.rotational.energy, color: "#7c3aed" },
    { id: "electronic", label: "Electronic (thermal)", value: view.components.electronic.energy - view.e0, color: "#64748b" },
  ];
  const maxThermal = Math.max(...thermalTerms.map((term) => Math.abs(term.value)), 1e-12);
  const entropySlices = [
    { id: "translational", label: "Translational", value: view.components.translational.entropy, color: "#0284c7" },
    { id: "rotational", label: "Rotational", value: view.components.rotational.entropy, color: "#7c3aed" },
    { id: "vibrational", label: "Vibrational", value: view.components.vibrational.entropy, color: "#d97706" },
    { id: "electronic", label: "Electronic", value: view.components.electronic.entropy, color: "#64748b" },
  ];
  const trendPoints = sampleTrend(model, view.pressurePa, trendQuantity);
  const trendPerK = isPerKelvin(trendQuantity);
  const trendFactor = trendPerK ? perKelvinFactor(unit, factors) : energyFactor(unit, factors);
  const trendUnit = trendPerK ? perK : unit;
  const trendItem = TREND_QUANTITIES.find((item) => item.id === trendQuantity);
  const trendLabel = trendItem?.label ?? "";
  const trendShort = trendItem?.short ?? "";
  const trendScaled = trendPoints.map((point) => ({ x: point.x, y: point.y * trendFactor }));
  const trendMarker = { x: view.temperatureK, y: trendValue(view, trendQuantity) * trendFactor };
  const trendAvailable = view.temperatureK >= trendPoints[0]!.x && view.temperatureK <= trendPoints[trendPoints.length - 1]!.x;

  const summaryRows: Array<{ id: string; label: string; text: string; unit: string; note?: string; independent?: boolean }> = [
    { id: "e0", label: "Electronic energy (E₀)", text: energy(view.e0), unit, independent: true, note: "Independent of T and P" },
    { id: "zpe", label: "Zero-point energy (ZPE)", text: energy(view.zpe), unit, independent: true, note: "Independent of T and P" },
    { id: "u-corr", label: "Thermal correction to U", text: energy(view.corrections.internalEnergy), unit, note: "Relative to E₀; includes ZPE" },
    { id: "h-corr", label: "Thermal correction to H", text: energy(view.corrections.enthalpy), unit, note: "Relative to E₀; includes ZPE" },
    { id: "g-corr", label: "Thermal correction to G", text: energy(view.corrections.gibbs), unit, note: "Relative to E₀; includes ZPE" },
    { id: "entropy", label: "Entropy (S)", text: perKelvin(view.entropy), unit: perK },
    { id: "u", label: "Total internal energy (U)", text: energy(view.internalEnergy), unit, note: "Includes E₀" },
    { id: "h", label: "Total enthalpy (H)", text: energy(view.enthalpy), unit, note: "Includes E₀" },
    { id: "g", label: "Total Gibbs free energy (G)", text: energy(view.gibbs), unit, note: "Includes E₀" },
    { id: "cv", label: "Heat capacity (Cv)", text: perKelvin(view.cv), unit: perK },
    { id: "cp", label: "Heat capacity (Cp)", text: perKelvin(view.cp), unit: perK },
  ];

  function adjustTemperature(delta: number) {
    const typed = temperatureInput.trim() === "" ? Number.NaN : draftTemperatureK;
    const base = Number.isFinite(typed) ? typed : temperatureK;
    updateDraft(String(Number((base + delta).toFixed(2))), pressureInput);
  }
  function adjustPressure(delta: number) {
    const typed = pressureInput.trim() === "" ? Number.NaN : Number(pressureInput);
    const base = Number.isFinite(typed) ? typed : pressurePa / STANDARD_ATMOSPHERE_PA;
    updateDraft(temperatureInput, String(Number(Math.max(0, base + delta).toPrecision(6))));
  }
  async function calculateAuthoritative() {
    if (!onRequestConditions || validation) return;
    setRequest({ state: "pending" });
    const outcome = await onRequestConditions({
      frequencyResultId: payload!.frequency_result_id,
      structureVersionId: payload!.input_structure_version_id,
      temperatureK,
      pressurePa,
    });
    setRequest(outcome.error ? { state: "error", message: outcome.error } : { state: "idle" });
  }
  function showDetails() {
    setDetailsOpen(true);
    window.setTimeout(() => detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
  }

  const modeHeader = selectedMode !== null ? analysis?.modes[selectedMode] : undefined;

  return (
    <div
      className="spectro-workspace thermo-workspace"
      data-testid="thermochemistry-panel"
      data-draft-invalid={validation ? "true" : undefined}
    >
      <SpectroscopyHeader
        testIdPrefix="thermo"
        title="Thermochemistry"
        statusLabel={validation ? "Invalid input" : isPreview ? "Preview" : ""}
        statusTone={validation ? "warn" : "ok"}
        subtitle={`${payload.method.toUpperCase()} / ${payload.basis} · PySCF ${payload.engine_version} · ${conditionsLabel(view.temperatureK, view.pressurePa)} · ideal-gas RRHO`}
        warning={lowModes.length ? "Low-frequency modes" : undefined}
        onDetails={showDetails}
        onSwitchToAdvanced={onSwitchToAdvanced}
        viewToggle={
          <div className="thermo-conditions" data-testid="thermo-conditions">
            <label className="thermo-field">
              <span>Temperature (K)</span>
              <span className="thermo-stepper">
                <button type="button" aria-label="Decrease temperature" onClick={() => adjustTemperature(-25)}>−</button>
                <input
                  data-testid="thermo-temperature-input"
                  aria-label="Temperature in kelvin"
                  inputMode="decimal"
                  value={temperatureInput}
                  aria-invalid={invalidFields.includes("temperature")}
                  onChange={(event) => updateDraft(event.target.value, pressureInput)}
                />
                <button type="button" aria-label="Increase temperature" onClick={() => adjustTemperature(25)}>+</button>
              </span>
            </label>
            <label className="thermo-field">
              <span>Pressure (atm)</span>
              <span className="thermo-stepper">
                <button type="button" aria-label="Decrease pressure" onClick={() => adjustPressure(-0.5)}>−</button>
                <input
                  data-testid="thermo-pressure-input"
                  aria-label="Pressure in atmospheres"
                  inputMode="decimal"
                  value={pressureInput}
                  aria-invalid={invalidFields.includes("pressure")}
                  onChange={(event) => updateDraft(temperatureInput, event.target.value)}
                />
                <button type="button" aria-label="Increase pressure" onClick={() => adjustPressure(0.5)}>+</button>
              </span>
            </label>
          </div>
        }
      />

      {validation ? (
        <div className="vibrational-warning thermo-draft-alert" role="alert" data-testid="thermo-validation-error">
          <strong>Invalid {invalidFields.join(" and ")}.</strong> {validation} Showing last valid{" "}
          {isPreview ? "preview" : "result"} at {conditionsLabel(view.temperatureK, view.pressurePa)}.
        </div>
      ) : null}

      {isPreview && !validation ? (
        <div className="thermo-banner thermo-banner--preview" role="status" data-testid="thermo-preview-banner">
          <div>
            <strong>Preview at {conditionsLabel(view.temperatureK, view.pressurePa)}</strong>
            <span>
              Deterministic evaluation of the stored ideal-gas RRHO model — not an authoritative record. The optimized
              geometry, E₀ and harmonic frequencies are unchanged; no SCF or Hessian is rerun.
            </span>
          </div>
          {onRequestConditions ? (
            <button
              type="button"
              className="spectro-link-btn"
              onClick={() => void calculateAuthoritative()}
              disabled={request.state === "pending"}
              data-testid="thermo-calculate-btn"
            >
              {request.state === "pending" ? "Calculating…" : "Calculate authoritative result"}
            </button>
          ) : null}
        </div>
      ) : null}
      {request.state === "error" ? (
        <div className="vibrational-warning" role="alert" data-testid="thermo-request-error">{request.message}</div>
      ) : null}
      {warnings.map((warning, index) => (
        <div className="vibrational-warning" role="alert" key={`${index}-${warning}`} data-testid="thermo-warning">
          <strong>Diagnostic:</strong> {warning}
        </div>
      ))}

      <div className="spectro-primary thermo-primary">
        <ThermochemistryViewer
          source={source}
          analysis={analysis}
          selectedModeIndex={selectedMode}
          playing={playing}
          exaggeration={exaggeration}
          speed={speed}
          caption={`Optimized geometry · ${payload.method.toUpperCase()} / ${payload.basis}`}
          persistenceKey={`chemdft:thermo:${projectId}:${payload.input_structure_version_id}:3d`}
        />

        <aside className="spectro-summary thermo-summary" data-testid="thermo-summary" aria-label="Thermochemical properties">
          <div className="spectro-summary-head">
            <h3>Thermochemical Properties</h3>
            <SegmentedToggle
              label="Energy unit"
              value={unit}
              onChange={setUnit}
              options={ENERGY_UNITS.map((item) => ({
                value: item,
                label: item,
                testId: `thermo-unit-${item === "Eh" ? "eh" : item === "kJ/mol" ? "kj" : "kcal"}`,
              }))}
            />
          </div>
          <table className="thermo-table">
            <tbody>
              {summaryRows.map((row) => (
                <tr key={row.id} data-testid={`thermo-row-${row.id}`} className={row.independent ? "is-independent" : undefined}>
                  <th scope="row" title={row.note}>
                    {row.label}
                    {row.independent ? <span className="thermo-tag">T-independent</span> : null}
                  </th>
                  <td data-testid={`thermo-value-${row.id}`}>{row.text}</td>
                  <td className="thermo-unit">{row.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="thermo-footnote">
            Corrections are defined relative to E₀ and include ZPE. Totals include E₀. Ideal gas · rigid rotor · harmonic
            oscillator · σ = {payload.symmetry.rotational_symmetry_number}.
          </p>
        </aside>
      </div>

      <section className="thermo-section" aria-label="Thermodynamic contributions" data-testid="thermo-contributions">
        <h3>Thermodynamic Contributions <span className="thermo-section-sub">({conditionsLabel(view.temperatureK, view.pressurePa)})</span></h3>
        <div className="thermo-cards">
          <div className="thermo-card" data-testid="thermo-energy-card">
            <h4>Thermal energy contributions</h4>
            <p className="thermo-card-note">
              Terms of U − E₀ in {unit}. E₀ ({formatEnergy(view.e0, unit, factors)} {unit}) is shown separately; it is
              orders of magnitude larger than any thermal term.
            </p>
            {thermalTerms.map((term) => (
              <ContributionBar
                key={term.id}
                id={term.id}
                label={term.label}
                value={term.value}
                max={maxThermal}
                color={term.color}
                text={`${energy(term.value)} ${unit}`}
              />
            ))}
            <div className="thermo-bar-total">
              <span>Total U − E₀</span>
              <strong data-testid="thermo-energy-total">{energy(view.corrections.internalEnergy)} {unit}</strong>
            </div>
          </div>

          <div className="thermo-card" data-testid="thermo-entropy-card">
            <h4>Entropy contributions</h4>
            <EntropyDonut
              slices={entropySlices}
              centerLabel={perKelvin(view.entropy)}
              centerUnit={perK}
              formatValue={(value) => `${perKelvin(value)}`}
            />
          </div>

          <div className="thermo-card" data-testid="thermo-trend-card">
            <div className="thermo-card-head">
              <h4>Temperature trend</h4>
              <select
                aria-label="Trend quantity"
                data-testid="thermo-trend-select"
                value={trendQuantity}
                onChange={(event) => setTrendQuantity(event.target.value as TrendQuantity)}
              >
                {TREND_QUANTITIES.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </div>
            <TrendChart
              points={trendScaled}
              marker={trendAvailable ? trendMarker : undefined}
              xLabel="Temperature (K)"
              yLabel={`${trendShort} (${trendUnit})`}
              ariaLabel={`${trendLabel} versus temperature`}
              formatY={(value) => (trendUnit === "Eh/K" ? value.toExponential(1) : trendUnit === "Eh" ? value.toFixed(3) : Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1))}
            />
            <p className="thermo-card-note">
              Deterministic evaluation of the stored model at {formatPressure(view.pressurePa)} (100–1000 K). Sampled
              values are not separate calculations. Pressure ({pressureAtm.toPrecision(4)} atm) affects translational
              entropy and G only — never E₀ or the frequencies.
            </p>
          </div>
        </div>
      </section>

      <section className="thermo-section" aria-label="Vibrational modes" data-testid="thermo-modes">
        <div className="thermo-section-head">
          <h3>Vibrational Mode Contributions</h3>
          {selectedMode !== null && modeHeader ? (
            <div className="thermo-mode-controls" data-testid="thermo-mode-controls">
              <span>Mode {selectedMode + 1} · {modeHeader.frequency_cm1.toFixed(1)} cm⁻¹</span>
              <button
                type="button"
                className="spectro-link-btn"
                onClick={() => setPlaying((value) => !value)}
                aria-pressed={playing}
                aria-label={playing ? "Pause animation" : "Play animation"}
                data-testid="thermo-play-pause-btn"
              >
                {playing ? "❚❚ Pause" : "▶ Play"}
              </button>
              <label title="Display-only exaggeration of the animated motion. It does not change the calculated normal modes.">
                <span>Visual exaggeration</span>
                <input
                  type="range"
                  aria-label="Visual exaggeration"
                  data-testid="thermo-exaggeration"
                  min={MIN_VISUAL_EXAGGERATION}
                  max={MAX_VISUAL_EXAGGERATION}
                  step="0.25"
                  value={exaggeration}
                  onChange={(event) => setExaggeration(Number(event.currentTarget.value))}
                />
                <output>{exaggeration.toFixed(2)}×</output>
              </label>
              <button
                type="button"
                className="spectro-link-btn"
                onClick={() => setSelectedMode(null)}
                data-testid="thermo-clear-mode-btn"
              >
                Show equilibrium
              </button>
            </div>
          ) : (
            <span className="thermo-card-note">
              Each mode’s contributions follow from its harmonic frequency at {conditionsLabel(view.temperatureK, view.pressurePa)}.
              Select a mode to animate it.
            </span>
          )}
        </div>
        <table className="spectro-table" data-testid="thermo-modes-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Frequency (cm⁻¹)</th>
              <th>ZPE ({unit})</th>
              <th>Thermal energy ({unit})</th>
              <th>Entropy ({perK})</th>
              <th>Cv ({perK})</th>
              <th>Animation</th>
            </tr>
          </thead>
          <tbody>
            {view.modes.map((mode) => {
              const selected = selectedMode === mode.index;
              return (
                <tr
                  key={mode.index}
                  data-testid={`thermo-mode-row-${mode.index + 1}`}
                  aria-selected={selected}
                  onClick={() => chooseMode(mode.index)}
                >
                  <td>{selected ? "● " : ""}{mode.index + 1}</td>
                  <td>
                    {mode.frequencyCm1.toFixed(1)}
                    {mode.lowFrequency ? <span className="thermo-tag thermo-tag--warn">&lt; {activePayload?.diagnostics.low_frequency_threshold_cm1} cm⁻¹</span> : null}
                  </td>
                  <td>{energy(mode.zpe)}</td>
                  <td>{energy(mode.thermalEnergy)}</td>
                  <td>{perKelvin(mode.entropy)}</td>
                  <td>{perKelvin(mode.cv)}</td>
                  <td>
                    <button
                      type="button"
                      className="spectro-row-play"
                      aria-label={`Animate mode ${mode.index + 1}`}
                      title={analysis ? "Animate this normal mode" : "Loading normal modes…"}
                      disabled={!analysis}
                      onClick={(event) => {
                        event.stopPropagation();
                        chooseMode(mode.index);
                      }}
                    >
                      ▶
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <details
        ref={detailsRef}
        className="thermo-details"
        open={detailsOpen}
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        data-testid="thermo-details"
      >
        <summary>Model, assumptions and provenance</summary>
        <div className="thermo-details-grid">
          <div>
            <h4>Model and assumptions</h4>
            <ul>
              {payload.conditions.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
              <li>
                Standard state: ideal gas at the stated pressure
                {Math.abs(view.pressurePa - STANDARD_ATMOSPHERE_PA) < 1e-6 ? " (1 atm, the conventional standard state)" : ""}.
              </li>
              <li>Rotational symmetry number σ = {payload.symmetry.rotational_symmetry_number} ({payload.symmetry.source === "user-override" ? "recorded user override" : "ChemDFT proper-rotation count"}).</li>
            </ul>
          </div>
          <div>
            <h4>Source and validity</h4>
            <ul>
              <li>Geometry: ChemDFT optimization (gradient RMS {payload.diagnostics.stationarity.gradient_rms_hartree_per_bohr.toExponential(1)} Eh/bohr ≤ {payload.diagnostics.stationarity.criterion_rms_hartree_per_bohr.toExponential(0)}).</li>
              <li>Frequencies: result {SHORT(payload.frequency_result_id)} · no imaginary modes.</li>
              <li>E₀ from hash-referenced artifact {SHORT(payload.energy_artifact.artifact_id)}.</li>
              <li>Lowest real frequency {payload.diagnostics.lowest_real_frequency_cm1.toFixed(1)} cm⁻¹.</li>
            </ul>
            {onSwitchToAdvanced ? (
              <button type="button" className="spectro-link-btn" onClick={onSwitchToAdvanced}>
                Full provenance in Advanced
              </button>
            ) : null}
          </div>
        </div>
      </details>

      {family.length > 1 ? (
        <div className="thermo-family" data-testid="thermo-family">
          <span>Calculated conditions:</span>
          {family.map((record) => (
            <button
              key={record.resultId}
              type="button"
              className="spectro-link-btn"
              aria-pressed={matching?.resultId === record.resultId}
              onClick={() => {
                setDraftState({
                  key: baseKey,
                  temperature: String(record.payload.conditions.temperature_k),
                  pressure: atmText(record.payload.conditions.pressure_pa),
                  valid: { temperatureK: record.payload.conditions.temperature_k, pressurePa: record.payload.conditions.pressure_pa },
                });
                onSelectResult?.(record.resultId);
              }}
            >
              {conditionsLabel(record.payload.conditions.temperature_k, record.payload.conditions.pressure_pa)}
            </button>
          ))}
        </div>
      ) : null}
      <span hidden data-testid="thermo-active-conditions">{formatTemperature(view.temperatureK)}|{formatPressure(view.pressurePa)}|{view.origin}</span>
    </div>
  );
}
