"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TddftResult, ExcitedState, StructureVersionDetail } from "@chemdft/schemas";
import { AppIcon, StatusTag } from "@chemdft/ui";
import { getStructureVersion } from "@/lib/structure-workspace-api";
import { compactStructureTitle } from "@/lib/structure-workbench";
import {
  deriveBroadenedSpectrum,
  DEFAULT_FWHM_EV,
  MIN_FWHM_EV,
  MAX_FWHM_EV,
  type SpectrumStick,
} from "@/lib/spectrum";
import { ScientificVisualizationPanel } from "./scientific-visualization-panel";
import { SpectroscopyHeader } from "./spectroscopy-shell";

type EChartsInstance = {
  setOption: (option: unknown, notMerge?: boolean) => void;
  resize: () => void;
  dispose: () => void;
  on: (event: string, handler: (params: unknown) => void) => void;
};
type EChartsModule = { init: (element: HTMLElement) => EChartsInstance };

export interface UvVisSpectroscopyPanelProps {
  projectId: string;
  calculationId: string;
  resultId: string;
  result: TddftResult;
  active?: boolean | undefined;
  onSelectOrbital?: ((moIndex: number) => void) | undefined;
  onSwitchToAdvanced?: (() => void) | undefined;
  structureName?: string | undefined;
  initialSelectedState?: string | null | undefined;
  onStateSelected?: ((stateLabel: string | null) => void) | undefined;
}

export function UvVisSpectroscopyPanel({
  projectId,
  calculationId,
  resultId,
  result,
  active = true,
  onSelectOrbital,
  onSwitchToAdvanced,
  structureName,
  initialSelectedState,
  onStateSelected,
}: UvVisSpectroscopyPanelProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<EChartsInstance | null>(null);

  const [structure, setStructure] = useState<StructureVersionDetail | null>(null);
  const [domainMode, setDomainMode] = useState<"energy" | "wavelength">("energy");
  const [fwhmEv, setFwhmEv] = useState<number>(DEFAULT_FWHM_EV);
  const [selectedStateIndex, setSelectedStateIndex] = useState<number | null>(() => {
    if (initialSelectedState === null) return null;
    if (typeof initialSelectedState === "string") {
      const match = result.excited_states.find(
        (s) => s.state_label.toUpperCase() === initialSelectedState.toUpperCase()
      );
      if (match) return match.index;
    }
    return null;
  });
  const [sortField, setSortField] = useState<"index" | "energy_ev" | "wavelength_nm" | "oscillator_strength">("index");
  const [sortAscending, setSortAscending] = useState<boolean>(true);

  useEffect(() => {
    if (initialSelectedState === undefined) return;
    queueMicrotask(() => {
      if (initialSelectedState === null) {
        setSelectedStateIndex(null);
      } else {
        const match = result.excited_states.find(
          (s) => s.state_label.toUpperCase() === initialSelectedState.toUpperCase(),
        );
        if (match) {
          setSelectedStateIndex(match.index);
        }
      }
    });
  }, [initialSelectedState, result.excited_states]);

  // Parent notification must not run inside a state updater (React forbids updating
  // another component while this one renders), so derive the next value from state here.
  const handleSelectState = useCallback(
    (idx: number | null) => {
      const nextIdx = idx === selectedStateIndex ? null : idx;
      setSelectedStateIndex(nextIdx);
      if (nextIdx == null) {
        onStateSelected?.(null);
      } else {
        const match = result.excited_states.find((s) => s.index === nextIdx);
        onStateSelected?.(match?.state_label ?? null);
      }
    },
    [result.excited_states, onStateSelected, selectedStateIndex],
  );

  useEffect(() => {
    let alive = true;
    if (result.input_structure_id && result.input_structure_version_id) {
      void getStructureVersion({
        projectId,
        structureId: result.input_structure_id,
        versionId: result.input_structure_version_id,
      })
        .then((detail) => {
          if (alive) setStructure(detail);
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [projectId, result.input_structure_id, result.input_structure_version_id]);

  const structPrefix =
    structureName ||
    (structure
      ? compactStructureTitle(structure.structure.name, structure.version.revision)
      : "Water V1");

  // Authoritative discrete sticks from engine result
  const sticks: SpectrumStick[] = useMemo(() => {
    return result.excited_states.map((s, idx) => ({
      stateIndex: s.index ?? idx,
      stateLabel: s.state_label,
      energyEv: s.energy_ev,
      energyHartree: s.energy_hartree,
      wavelengthNm: s.wavelength_nm,
      oscillatorStrength: s.oscillator_strength,
      converged: s.converged ?? true,
    }));
  }, [result.excited_states]);

  // Derived broadened spectrum (recomputed strictly from immutable sticks)
  const broadened = useMemo(() => {
    return deriveBroadenedSpectrum(sticks, { fwhmEv });
  }, [sticks, fwhmEv]);

  const selectedState: ExcitedState | null = useMemo(() => {
    if (selectedStateIndex == null) return null;
    return (
      result.excited_states.find((s) => s.index === selectedStateIndex) ?? null
    );
  }, [result.excited_states, selectedStateIndex]);

  // Find strongest state for quick highlight/comparison
  const strongestState: ExcitedState | undefined = useMemo(() => {
    if (!result.excited_states.length) return undefined;
    return [...result.excited_states].sort(
      (a, b) => b.oscillator_strength - a.oscillator_strength
    )[0];
  }, [result.excited_states]);

  // Sorted states for the transition table
  const sortedStates = useMemo(() => {
    return [...result.excited_states].sort((a, b) => {
      let diff = 0;
      if (sortField === "index") diff = a.index - b.index;
      else if (sortField === "energy_ev") diff = a.energy_ev - b.energy_ev;
      else if (sortField === "wavelength_nm") diff = a.wavelength_nm - b.wavelength_nm;
      else if (sortField === "oscillator_strength") diff = a.oscillator_strength - b.oscillator_strength;
      return sortAscending ? diff : -diff;
    });
  }, [result.excited_states, sortField, sortAscending]);

  function handleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortAscending(!sortAscending);
    } else {
      setSortField(field);
      setSortAscending(field === "index" || field === "energy_ev");
    }
  }

  // Broadcast current view selection for AI Scientist context
  useEffect(() => {
    if (!active) return;
    const viewLabel = selectedState
      ? `${structPrefix} → UV/Vis → ${selectedState.state_label}`
      : `${structPrefix} → UV/Vis spectrum`;

    window.dispatchEvent(
      new CustomEvent("chemdft:workspace-selection", {
        detail: {
          projectId,
          calculationId,
          resultId,
          structureName: structure?.structure.name,
          structureVersionRevision: structure?.version.revision,
          currentView: viewLabel,
          selectedState: selectedState?.state_label ?? null,
          selectedTransition: selectedState?.dominant_transitions?.[0]
            ? {
                occupiedMo: selectedState.dominant_transitions[0].occupied_mo_index,
                virtualMo: selectedState.dominant_transitions[0].virtual_mo_index,
                x: selectedState.dominant_transitions[0].x,
                y: selectedState.dominant_transitions[0].y,
              }
            : null,
        },
      })
    );
  }, [active, projectId, calculationId, resultId, structPrefix, selectedState, structure]);

  // ECharts rendering effect
  useEffect(() => {
    if (!chartRef.current || !active) return;

    let disposed = false;
    let chartInstance: EChartsInstance | null = null;

    void (async () => {
      const echarts = ((await import("echarts")) as unknown) as EChartsModule;
      if (disposed || !chartRef.current) return;

      if (!chartInstanceRef.current) {
        chartInstanceRef.current = echarts.init(chartRef.current);
      }
      chartInstance = chartInstanceRef.current;

      const isEnergy = domainMode === "energy";
      const xName = isEnergy ? "Energy (eV)" : "Wavelength (nm)";
      const curveData = isEnergy
        ? broadened.energyCurve.map((pt) => [pt.energyEv, pt.intensity])
        : broadened.wavelengthCurve.map((pt) => [pt.wavelengthNm, pt.intensity]);

      // Sticks represented as vertical bar/lines or scatter markers with custom styling
      const stickScatterData = sticks.map((s) => {
        const xVal = isEnergy ? s.energyEv : s.wavelengthNm;
        const isSelected = s.stateIndex === selectedStateIndex;
        const isStrongest = s.stateIndex === (strongestState?.index ?? -1);
        return {
          name: s.stateLabel,
          value: [xVal, s.oscillatorStrength],
          stateIndex: s.stateIndex,
          itemStyle: {
            color: isSelected ? "#0d8050" : isStrongest ? "#2b6cb0" : "#5c7080",
          },
        };
      });

      // Discrete sticks lines
      const stickLinesData = sticks.map((s) => {
        const xVal = isEnergy ? s.energyEv : s.wavelengthNm;
        const isSelected = s.stateIndex === selectedStateIndex;
        return {
          coords: [
            [xVal, 0],
            [xVal, s.oscillatorStrength],
          ],
          lineStyle: {
            color: isSelected ? "#0d8050" : "#5c7080",
            width: isSelected ? 3 : 1.5,
            type: "solid" as const,
          },
          stateIndex: s.stateIndex,
        };
      });

      // Selected state vertical markLine
      const selectedX = selectedState
        ? isEnergy
          ? selectedState.energy_ev
          : selectedState.wavelength_nm
        : null;

      const option = {
        animation: false,
        backgroundColor: "transparent",
        grid: {
          left: 60,
          right: 32,
          top: 36,
          bottom: 50,
        },
        tooltip: {
          trigger: "item",
          backgroundColor: "#172f42",
          borderColor: "#254865",
          textStyle: { color: "#ffffff", fontSize: 12 },
          formatter: (params: {
            seriesType?: string;
            data?: { name?: string; value?: [number, number]; stateIndex?: number };
            value?: [number, number];
          }) => {
            if (params.data?.stateIndex !== undefined) {
              const st = sticks.find((s) => s.stateIndex === params.data?.stateIndex);
              if (st) {
                return `<strong>${st.stateLabel}</strong><br/>
                Energy: <b>${st.energyEv.toFixed(3)} eV</b> (${st.energyHartree.toFixed(5)} E<sub>h</sub>)<br/>
                Wavelength: <b>${st.wavelengthNm.toFixed(1)} nm</b><br/>
                Oscillator strength: <b>${st.oscillatorStrength.toFixed(4)}</b><br/>
                <i>Click stick to inspect state</i>`;
              }
            }
            if (params.value && Array.isArray(params.value)) {
              return `${xName}: <b>${params.value[0].toFixed(2)}</b><br/>
              Intensity: <b>${params.value[1].toFixed(4)} a.u.</b>`;
            }
            return "";
          },
        },
        xAxis: {
          type: "value",
          name: xName,
          nameLocation: "middle",
          nameGap: 30,
          scale: true,
          axisLine: { lineStyle: { color: "#8294a3" } },
          axisLabel: {
            color: "#405060",
            formatter: (val: number) => val.toFixed(1),
          },
          splitLine: { lineStyle: { color: "#e6ecf0", type: "dashed" } },
        },
        yAxis: {
          type: "value",
          name: "Relative absorption intensity (a.u.)",
          nameLocation: "middle",
          nameGap: 44,
          scale: false,
          min: 0,
          axisLine: { lineStyle: { color: "#8294a3" } },
          axisLabel: { color: "#405060" },
          splitLine: { lineStyle: { color: "#e6ecf0", type: "dashed" } },
        },
        series: [
          // 1. Continuous Gaussian broadened curve
          {
            name: "Broadened spectrum",
            type: "line",
            smooth: true,
            showSymbol: false,
            data: curveData,
            lineStyle: {
              width: 2.2,
              color: "#1d6084",
            },
            areaStyle: {
              color: {
                type: "linear",
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: "rgba(29, 96, 132, 0.28)" },
                  { offset: 1, color: "rgba(29, 96, 132, 0.02)" },
                ],
              },
            },
            markLine: selectedX !== null ? {
              silent: true,
              symbol: "none",
              lineStyle: { color: "#0d8050", width: 2, type: "dashed" },
              data: [{ xAxis: selectedX }],
            } : undefined,
          },
          // 2. Vertical stick lines
          {
            name: "Oscillator strength sticks",
            type: "lines",
            coordinateSystem: "cartesian2d",
            polyline: false,
            data: stickLinesData,
            silent: false,
          },
          // 3. Stick endpoints (clickable markers)
          {
            name: "Excited states",
            type: "scatter",
            data: stickScatterData,
            symbol: "circle",
            symbolSize: (data: unknown, params: { data?: { stateIndex?: number } }) => {
              return params.data?.stateIndex === selectedStateIndex ? 10 : 7;
            },
            cursor: "pointer",
          },
        ],
      };

      chartInstance.setOption(option, true);

      // Handle clicking a stick or marker
      chartInstance.on("click", (params: unknown) => {
        const p = params as { data?: { stateIndex?: number } };
        if (p.data && typeof p.data.stateIndex === "number") {
          handleSelectState(p.data.stateIndex);
        }
      });
    })();

    // Follow container width changes (window resize, AI panel collapse).
    const handleResize = () => chartInstanceRef.current?.resize();
    window.addEventListener("resize", handleResize);
    const observer = chartRef.current ? new ResizeObserver(handleResize) : null;
    if (chartRef.current) observer?.observe(chartRef.current);

    return () => {
      disposed = true;
      window.removeEventListener("resize", handleResize);
      observer?.disconnect();
    };
  }, [domainMode, broadened, sticks, selectedStateIndex, strongestState, selectedState, active, handleSelectState]);

  const summaryState: ExcitedState | undefined = selectedState ?? strongestState;
  const summaryDominant = summaryState?.dominant_transitions?.[0];
  const showDetails = () => {
    const target = document.querySelector<HTMLElement>('[data-testid="selected-state-inspector"]');
    target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <div className="uvvis-spectroscopy-panel spectro-workspace" data-testid="uvvis-spectroscopy-panel">
      {/* 1. Header: same shell as IR and Raman */}
      <SpectroscopyHeader
        testIdPrefix="uvvis"
        statusLabel=""
        title="UV/Vis Spectroscopy"
        subtitle={`Restricted ${result.reference_method ?? "RKS"} · TDDFT · ${result.method.toUpperCase()} / ${result.basis.toUpperCase()} · ${result.excited_states.length} singlet excited states`}
        onDetails={showDetails}
        onSwitchToAdvanced={onSwitchToAdvanced}
      />

      {/* 2. Primary scientific area: molecule + selected-state summary */}
      <div className="spectro-primary">
        <div className="spectro-viewer">
          {structure ? (
            <ScientificVisualizationPanel
              compact
              detail={structure}
              selectedAtomIndex={null}
              measurementKind="none"
              measurementAtomIndices={[]}
              onSelectAtom={() => undefined}
              onMeasurementKindChange={() => undefined}
              onSceneReady={() => undefined}
              persistenceKey={`chemdft:uvvis:${projectId}:${resultId}:3d`}
            />
          ) : (
            <div className="spectro-viewer-loading">Loading molecular structure…</div>
          )}
          <div className="spectro-viewer-label" aria-live="off">
            {summaryState
              ? `${summaryState.state_label} · ${summaryState.energy_ev.toFixed(2)} eV · ${summaryState.wavelength_nm.toFixed(1)} nm`
              : "Ground-state geometry"}
          </div>
        </div>

        {summaryState ? (
          <aside className="spectro-summary" data-testid="uvvis-state-summary" aria-label={`Excited state ${summaryState.state_label}`}>
            <div className="spectro-summary-head">
              <h3>{summaryState.state_label}</h3>
              <span className="spectro-chip">{selectedState ? `Root #${summaryState.index + 1}` : "Strongest absorption"}</span>
            </div>
            <dl className="spectro-facts">
              <div><dt>Excitation energy</dt><dd>{summaryState.energy_ev.toFixed(3)} eV</dd></div>
              <div><dt>Wavelength</dt><dd>{summaryState.wavelength_nm.toFixed(1)} nm</dd></div>
              <div><dt>Oscillator strength (<em>f</em>)</dt><dd className="is-accent">{summaryState.oscillator_strength.toFixed(4)}</dd></div>
              <div><dt>HOMO–LUMO gap</dt><dd>{result.homo_lumo_gap_ev.toFixed(2)} eV</dd></div>
            </dl>
            {summaryDominant ? (
              <div className="spectro-dominant">
                <span className="spectro-dominant-title">Dominant transition</span>
                <strong>
                  MO {summaryDominant.occupied_mo_index + 1} ({summaryDominant.occupied_label}) → MO {summaryDominant.virtual_mo_index + 1} ({summaryDominant.virtual_label})
                </strong>
                <div className="spectro-dominant-actions">
                  <button type="button" className="spectro-link-btn" onClick={() => onSelectOrbital?.(summaryDominant.occupied_mo_index)}>
                    Occupied orbital
                  </button>
                  <button type="button" className="spectro-link-btn" onClick={() => onSelectOrbital?.(summaryDominant.virtual_mo_index)}>
                    Virtual orbital
                  </button>
                </div>
              </div>
            ) : null}
            <p className="spectro-hint">Select a peak or table row to change the state.</p>
          </aside>
        ) : null}
      </div>

      {/* 3. Spectrum */}
      <section className="spectro-spectrum uvvis-chart-section" aria-label="Interactive UV/Vis spectrum">
        <div className="spectro-spectrum-head">
          <h3>UV/Vis Spectrum</h3>
          <div className="spectro-spectrum-controls">
            <div className="spectro-segmented" role="group" aria-label="Spectrum domain">
              <button
                type="button"
                aria-pressed={domainMode === "energy"}
                onClick={() => setDomainMode("energy")}
                data-testid="toggle-domain-energy"
              >
                Energy (eV)
              </button>
              <button
                type="button"
                aria-pressed={domainMode === "wavelength"}
                onClick={() => setDomainMode("wavelength")}
                data-testid="toggle-domain-wavelength"
              >
                Wavelength (nm)
              </button>
            </div>
            <details className="spectro-settings">
              <summary>Spectrum settings</summary>
              <div className="spectro-settings-body">
                <label htmlFor="fwhm-slider">
                  <span>Gaussian FWHM</span>
                  <input
                    id="fwhm-slider"
                    type="range"
                    min={MIN_FWHM_EV}
                    max={MAX_FWHM_EV}
                    step={0.01}
                    value={fwhmEv}
                    onChange={(e) => setFwhmEv(parseFloat(e.target.value))}
                    aria-label="Gaussian peak broadening FWHM in eV"
                    data-testid="fwhm-slider"
                  />
                  <output>{fwhmEv.toFixed(2)} eV</output>
                </label>
              </div>
            </details>
          </div>
        </div>
        <p className="spectro-caption">
          Sticks are the calculated excited states (oscillator strength <em>f</em>); the curve is a derived Gaussian broadening for display.
        </p>
        <div
          ref={chartRef}
          className="uvvis-echarts-container"
          style={{ width: "100%", height: "320px" }}
          data-testid="uvvis-chart-canvas"
        />
      </section>

      {/* 4. Orbital-energy vs excitation-energy distinction (kept, but secondary) */}
      <details className="spectro-note" data-testid="uvvis-distinction-banner">
        <summary>
          HOMO–LUMO gap {result.homo_lumo_gap_ev.toFixed(2)} eV vs S1 excitation {result.excited_states[0]?.energy_ev.toFixed(2)} eV ({result.excited_states[0]?.wavelength_nm.toFixed(1)} nm) — why they differ
        </summary>
        <p>
          The HOMO-LUMO gap is the difference between ground-state Kohn-Sham frontier orbital eigenvalues. The S1 TDDFT excitation is a physical electronic transition that accounts for electron-hole interaction and linear response, so the two are not the same quantity.
        </p>
      </details>

      {/* 4. Bottom Grid: Transition Table & Selected State Inspector */}
      <div className="uvvis-details-grid">
        {/* Left Column: Transition Table (Section 18) */}
        <section className="uvvis-table-card" aria-label="Excited states table">
          <div className="card-header-row">
            <h3 className="card-title">Excited States</h3>
            <span className="card-count">{result.excited_states.length} states</span>
          </div>

          <div className="table-responsive-wrap">
            <table className="uvvis-states-table" data-testid="uvvis-states-table">
              <thead>
                <tr>
                  <th
                    scope="col"
                    className={`sortable ${sortField === "index" ? "sorted" : ""}`}
                    onClick={() => handleSort("index")}
                  >
                    State {sortField === "index" ? (sortAscending ? "▲" : "▼") : ""}
                  </th>
                  <th
                    scope="col"
                    className={`sortable ${sortField === "energy_ev" ? "sorted" : ""}`}
                    onClick={() => handleSort("energy_ev")}
                  >
                    Energy (eV) {sortField === "energy_ev" ? (sortAscending ? "▲" : "▼") : ""}
                  </th>
                  <th
                    scope="col"
                    className={`sortable ${sortField === "wavelength_nm" ? "sorted" : ""}`}
                    onClick={() => handleSort("wavelength_nm")}
                  >
                    Wavelength (nm) {sortField === "wavelength_nm" ? (sortAscending ? "▲" : "▼") : ""}
                  </th>
                  <th
                    scope="col"
                    className={`sortable ${sortField === "oscillator_strength" ? "sorted" : ""}`}
                    onClick={() => handleSort("oscillator_strength")}
                  >
                    <em>f</em> (length) {sortField === "oscillator_strength" ? (sortAscending ? "▲" : "▼") : ""}
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedStates.map((st) => {
                  const isSelected = st.index === selectedStateIndex;
                  const isStrongest = st.index === (strongestState?.index ?? -1);
                  return (
                    <tr
                      key={st.index}
                      className={`state-row ${isSelected ? "selected-row" : ""}`}
                      onClick={() => handleSelectState(st.index)}
                      data-testid={`state-row-${st.state_label}`}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleSelectState(st.index);
                        }
                      }}
                    >
                      <td>
                        <strong>{st.state_label}</strong>
                        {isStrongest ? <span className="strongest-tag">Strongest</span> : null}
                      </td>
                      <td>{st.energy_ev.toFixed(3)}</td>
                      <td>{st.wavelength_nm.toFixed(1)}</td>
                      <td>{st.oscillator_strength.toFixed(4)}</td>
                      <td>
                        <span className="status-converged" title="Root converged">✓</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Right Column: Selected State Inspector or Overview (Section 19 & 20) */}
        {!selectedState ? (
          <section className="uvvis-inspector-card" aria-label="Spectrum overview inspector" data-testid="selected-state-inspector">
            <div className="card-header-row">
              <h3 className="card-title">Spectrum Overview</h3>
              <StatusTag intent="primary">{result.excited_states.length} Roots</StatusTag>
            </div>
            <div className="inspector-metrics-grid">
              <div className="metric-tile">
                <span className="metric-label">Dominant Absorption</span>
                <strong className="metric-val">{strongestState?.state_label ?? "—"}</strong>
                <span className="metric-sub">{strongestState ? `${strongestState.energy_ev.toFixed(3)} eV` : "—"}</span>
              </div>
              <div className="metric-tile">
                <span className="metric-label">Max Oscillator Strength</span>
                <strong className="metric-val">{result.max_oscillator_strength != null ? result.max_oscillator_strength.toFixed(4) : "—"}</strong>
                <span className="metric-sub">{strongestState?.oscillator_strength_gauge ?? "length"} gauge</span>
              </div>
              <div className="metric-tile">
                <span className="metric-label">Broadening FWHM</span>
                <strong className="metric-val">{fwhmEv.toFixed(2)} eV</strong>
                <span className="metric-sub">Gaussian envelope</span>
              </div>
              <div className="metric-tile">
                <span className="metric-label">Active Space</span>
                <strong className="metric-val">{result.nocc ?? 0} occ / {result.nvir ?? 0} vir</strong>
                <span className="metric-sub">Ground state: {result.reference_method ?? "RKS"}</span>
              </div>
            </div>
            <div className="dominant-transitions-section" style={{ marginTop: "1rem" }}>
              <h4 className="section-subtitle">Excited State Selection</h4>
              <p className="disclaimer-note">
                Click any excited state in the spectrum plot or table to inspect its individual transition dipole, oscillator strength, and orbital response amplitudes.
              </p>
            </div>
          </section>
        ) : null}

        {selectedState ? (() => {
          const dx = Number(selectedState.transition_dipole[0] ?? 0);
          const dy = Number(selectedState.transition_dipole[1] ?? 0);
          const dz = Number(selectedState.transition_dipole[2] ?? 0);
          const dipoleMag = Math.sqrt(dx * dx + dy * dy + dz * dz);
          return (
          <section className="uvvis-inspector-card" aria-label="Selected state inspector" data-testid="selected-state-inspector">
            <div className="card-header-row">
              <h3 className="card-title">State {selectedState.state_label} Inspector</h3>
              <StatusTag intent="primary">Root #{selectedState.index + 1}</StatusTag>
            </div>

            <div className="inspector-metrics-grid">
              <div className="metric-tile">
                <span className="metric-label">Excitation Energy</span>
                <strong className="metric-val">{selectedState.energy_ev.toFixed(3)} eV</strong>
                <span className="metric-sub">{selectedState.energy_hartree.toFixed(5)} E<sub>h</sub></span>
              </div>
              <div className="metric-tile">
                <span className="metric-label">Calculated Wavelength</span>
                <strong className="metric-val">{selectedState.wavelength_nm.toFixed(1)} nm</strong>
                <span className="metric-sub">&lambda; = hc / E</span>
              </div>
              <div className="metric-tile">
                <span className="metric-label">Oscillator Strength (f)</span>
                <strong className="metric-val">{selectedState.oscillator_strength.toFixed(4)}</strong>
                <span className="metric-sub">{selectedState.oscillator_strength_gauge ?? "length"} gauge</span>
              </div>
              <div className="metric-tile">
                <span className="metric-label">Transition Dipole</span>
                <strong className="metric-val">
                  |&mu;| = {dipoleMag.toFixed(4)} a.u.
                </strong>
                <span className="metric-sub">
                  ({dx.toFixed(3)},{" "}
                  {dy.toFixed(3)},{" "}
                  {dz.toFixed(3)})
                </span>
              </div>
            </div>

            {/* Dominant Response Amplitudes */}
            <div className="dominant-transitions-section">
              <h4 className="section-subtitle">Dominant Response Amplitudes</h4>
              <p className="disclaimer-note">
                Response amplitudes are not transition probabilities.
              </p>

              <div className="transitions-list" data-testid="dominant-transitions-list">
                {selectedState.dominant_transitions?.map((trans, idx) => (
                  <div key={idx} className="transition-item">
                    <div className="transition-labels">
                      <strong className="transition-pair">
                        MO {trans.occupied_mo_index + 1} ({trans.occupied_label}) &rarr; MO {trans.virtual_mo_index + 1} ({trans.virtual_label})
                      </strong>
                      <div className="transition-values">
                        <span>X = {trans.x.toFixed(4)}</span>
                        {Math.abs(trans.y) > 0.0001 ? <span>Y = {trans.y.toFixed(4)}</span> : null}
                        <span className="trans-mag">|X| = {trans.magnitude.toFixed(4)}</span>
                      </div>
                    </div>

                    {/* Connect state to molecular orbitals (Section 20) */}
                    <div className="transition-mo-actions">
                      <button
                        type="button"
                        className="mo-link-btn"
                        onClick={() => onSelectOrbital?.(trans.occupied_mo_index)}
                        data-testid={`view-occ-mo-${trans.occupied_mo_index}`}
                        title={`View occupied MO ${trans.occupied_mo_index + 1} in 3D`}
                      >
                        <AppIcon icon="predictive-analysis" />
                        <span>View occupied ({trans.occupied_label})</span>
                      </button>
                      <button
                        type="button"
                        className="mo-link-btn"
                        onClick={() => onSelectOrbital?.(trans.virtual_mo_index)}
                        data-testid={`view-vir-mo-${trans.virtual_mo_index}`}
                        title={`View virtual MO ${trans.virtual_mo_index + 1} in 3D`}
                      >
                        <AppIcon icon="predictive-analysis" />
                        <span>View virtual ({trans.virtual_label})</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Technical Provenance (Section 26) */}
            <details className="uvvis-provenance-details">
              <summary>Technical calculation provenance</summary>
              <dl className="provenance-facts-grid">
                <div><dt>Engine</dt><dd>{typeof result.producer === "string" ? result.producer : "PySCF"} {result.engine_version}</dd></div>
                <div><dt>Ground-state Reference</dt><dd>{result.reference_method ?? "RKS"} · {result.ground_state_energy_hartree.toFixed(6)} E<sub>h</sub></dd></div>
                <div><dt>SCF Convergence</dt><dd>{result.scf_iterations ?? 0} cycles ({result.converged ? "Converged" : "Unconverged"})</dd></div>
                <div><dt>XC Functional</dt><dd>{result.method.toUpperCase()}</dd></div>
                <div><dt>Basis Set</dt><dd>{result.basis.toUpperCase()}</dd></div>
                <div><dt>Active Orbitals</dt><dd>{result.nocc} occupied, {result.nvir} virtual</dd></div>
                <div><dt>Input Hash</dt><dd><code>{result.calculation_input_hash?.slice(0, 16)}…</code></dd></div>
                <div><dt>Result SHA-256</dt><dd><code>{result.result_sha256?.slice(0, 16)}…</code></dd></div>
                <div><dt>Broadening Grid</dt><dd>Gaussian · {broadened.pointsCount} points ({broadened.energyMinEv.toFixed(1)}–{broadened.energyMaxEv.toFixed(1)} eV)</dd></div>
              </dl>
            </details>
          </section>
          );
        })() : null}
      </div>
    </div>
  );
}
