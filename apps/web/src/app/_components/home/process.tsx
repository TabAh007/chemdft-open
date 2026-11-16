"use client";

import { useEffect, useRef, useState } from "react";

import { PROCESS_STEPS } from "./content";
import { attemptSeconds, fixed, RUN, scientific, shortHash, utc } from "./run-record";
import { useStage, type ProcessStep } from "./stage";
import { loadGsap } from "./gsap";

/** All five stages inspect the same stored geometry and resting view. */
const STORED_STAGE: ProcessStep = { representation: "ball-stick", labels: false };

type Row = readonly [label: string, value: string, note?: string];

function rows(id: (typeof PROCESS_STEPS)[number]["id"]): readonly Row[] {
  const r = RUN.result;
  switch (id) {
    case "structure":
      return [
        ["Structure", "Water, H₂O"],
        ["Atoms", "3 · Cartesian, Å"],
        ["Source", "ChemDFT test geometry"],
        ["Record", "Immutable structure version"],
        ["Input structure SHA-256", shortHash(RUN.structure.input_structure_sha256)],
      ];
    case "prepare":
      return [
        ["Charge · multiplicity", `${RUN.structure.charge} · ${RUN.structure.multiplicity}`, "stated, not inferred"],
        ["Method · basis", `${RUN.method.method} · ${RUN.method.basis}`],
        ["SCF convergence", `${scientific(RUN.method.scf_convergence_threshold)} · max ${RUN.method.scf_max_iterations} cycles`],
      ];
    case "calculate":
      return [
        ["Engine", `${RUN.engine.name} ${RUN.engine.version}`],
        ["Execution", "Isolated worker process"],
        ["Attempt", `${RUN.attempt.number} · ${RUN.attempt.state.toLowerCase()} in ${attemptSeconds().toFixed(2)} s`],
        ["Started", utc(RUN.attempt.started_utc)],
      ];
    case "verify":
      return [
        ["SCF", `${r.converged ? "converged" : "not converged"} · ${r.scf_iterations} cycles`],
        ["Total SCF energy", `${fixed(r.total_energy_hartree, 10)} Eh`],
        ["Electrons", `${r.electron_count} · ${r.alpha_electrons} α / ${r.beta_electrons} β`],
        ["Basis functions", `${r.basis_functions} · ${r.molecular_orbitals} molecular orbitals`],
        ["Status", "Calculated · not reviewed", "computed does not mean checked by a person"],
      ];
    case "explore":
      return [
        [`HOMO · MO ${r.homo.index}`, `${fixed(r.homo.energy_hartree, 8)} Eh`, `${fixed(r.homo.energy_ev, 5)} eV`],
        [`LUMO · MO ${r.lumo.index}`, `${fixed(r.lumo.energy_hartree, 8)} Eh`, `${fixed(r.lumo.energy_ev, 5)} eV`],
        ["HOMO–LUMO gap", `${fixed(r.gap_hartree, 8)} Eh`, `${fixed(r.gap_ev, 5)} eV · ${r.gap_note.toLowerCase()}`],
      ];
  }
}

function Readout({ id }: { id: (typeof PROCESS_STEPS)[number]["id"] }) {
  return (
    <div className="readout" aria-label={`Stored calculation record: ${id}`} role="group">
      <p className="readout-head">
        <span>Recorded execution</span>
        <span className="mono">Water · HF / STO-3G · PySCF {RUN.engine.version}</span>
      </p>
      <dl>
        {rows(id).map(([label, value, note]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <span className="mono">{value}</span>
              {note ? <span className="readout-note">{note}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      {id === "calculate" ? (
        <ol className="lifecycle" aria-label="Recorded calculation lifecycle — completed" data-state="succeeded">
          <li data-s="queued">Queued</li>
          <li data-s="running">Running</li>
          <li data-s="succeeded">Succeeded</li>
        </ol>
      ) : null}
    </div>
  );
}

/**
 * Act II. One persistent 3D stage (water) and one continuous composition: a stage rail, the current stage's text and the
 * real stored run record beside it. On a wide screen with motion allowed, GSAP + ScrollTrigger drive which stage is
 * active and what the stage shows (representation, camera, labels) while the section is held by CSS `position: sticky`
 * — native scrolling is never intercepted. On phones and with reduced motion every stage is simply laid out in order.
 */
export function Process() {
  const root = useRef<HTMLElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const { setProcess, desktop, reducedMotion, webgl } = useStage();
  const stageApi = useRef({ setProcess });
  useEffect(() => {
    stageApi.current = { setProcess };
  }, [setProcess]);

  useEffect(() => {
    const section = root.current;
    if (!section) return;
    if (!desktop || reducedMotion) {
      delete section.dataset.mode;
      const update = () => {
        const box = section.getBoundingClientRect();
        stageApi.current.setProcess(box.top < window.innerHeight * 0.62 && box.bottom > 0 ? STORED_STAGE : null);
      };
      window.addEventListener("scroll", update, { passive: true });
      update();
      return () => { window.removeEventListener("scroll", update); stageApi.current.setProcess(null); };
    }
    section.dataset.mode = "pinned";
    let cancelled = false;
    let revert: (() => void) | undefined;
    void (async () => {
      const { gsap, ScrollTrigger } = await loadGsap();
      if (cancelled) return;
      const context = gsap.context(() => {
        const steps = gsap.utils.toArray<HTMLElement>("[data-step]", section);
        const rail = gsap.utils.toArray<HTMLElement>("[data-rail]", section);
        const progress = section.querySelector<HTMLElement>(".rail-progress");
        let current = -1;
        const show = (index: number) => {
          if (index === current) return;
          current = index;
          section.dataset.stage = PROCESS_STEPS[index]!.id;
          setActiveIndex(index);
          steps.forEach((step, i) => {
            const active = i === index;
            step.dataset.active = String(active);
            step.setAttribute("aria-hidden", String(!active));
            gsap.killTweensOf(step);
            gsap.set(step, { opacity: active ? 1 : 0, y: 0 });
            if (active) gsap.fromTo(step, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.18, ease: "power2.out", overwrite: true });
          });
          rail.forEach((item, i) => {
            if (i === index) item.setAttribute("aria-current", "step");
            else item.removeAttribute("aria-current");
            item.dataset.done = String(i < index);
          });
          stageApi.current.setProcess(STORED_STAGE);
        };

        // The stage switches to water as the section approaches, and back to the visitor's choice above it.
        ScrollTrigger.create({
          trigger: section,
          start: "top 62%",
          end: "bottom bottom",
          onEnter: () => show(0),
          onEnterBack: () => show(PROCESS_STEPS.length - 1),
          onLeave: () => show(PROCESS_STEPS.length - 1),
          onLeaveBack: () => {
            current = -1;
            steps.forEach((step) => (step.dataset.active = "false"));
            stageApi.current.setProcess(null);
          },
        });

        // Progress through the pinned part picks the stage; a hairline on the rail follows it (scrubbed).
        ScrollTrigger.create({
          trigger: section,
          start: "top top+=54",
          end: "bottom bottom",
          onUpdate: (self) => {
            const p = self.progress;
            if (progress) progress.style.transform = `scaleX(${p.toFixed(4)})`;
            const index = Math.min(PROCESS_STEPS.length - 1, Math.floor(p * PROCESS_STEPS.length));
            if (self.isActive) show(index);

          },
        });
        steps.forEach((step, i) => {
          step.dataset.active = String(i === 0);
          step.setAttribute("aria-hidden", String(i !== 0));
          gsap.set(step, { opacity: i === 0 ? 1 : 0, y: 0 });
        });
        ScrollTrigger.refresh();
      }, section);
      revert = () => context.revert();
    })();
    return () => {
      cancelled = true;
      revert?.();
      delete section.dataset.mode;
      delete section.dataset.stage;
      section.querySelectorAll("[data-step]").forEach((step) => step.removeAttribute("aria-hidden"));
      stageApi.current.setProcess(null);
    };
  }, [desktop, reducedMotion]);

  return (
    <section ref={root} className="process" id="how-it-works" aria-labelledby="process-title">
      <div className="process-pin">
        <header className="process-head interactive-text">
          <p className="eyebrow">How it works</p>
          <h2 id="process-title">From structure to calculation</h2>
          <p className="run-identity" data-testid="stored-water-handoff">Stored calculation example · Water · HF / {RUN.method.basis}</p>
        </header>
        <div className="process-rail-wrap interactive-text">
          <ol className="process-rail" aria-label="Stages of a calculation">
            {PROCESS_STEPS.map((step, i) => (
              <li key={step.id} data-rail={step.id}>
                <span className="rail-index">{i + 1}</span>
                {step.label}
              </li>
            ))}
          </ol>
          <span className="rail-track" aria-hidden="true">
            <span className="rail-progress" />
          </span>
        </div>
        <div className="process-steps">
          {PROCESS_STEPS.map((step) => (
            <article key={step.id} className="process-step interactive-text" data-step={step.id}>
              <div className="step-text">
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
              <div className="readout-mobile"><Readout id={step.id} /></div>
            </article>
          ))}
        </div>
        <div className="process-record interactive-text" data-testid="persistent-record"><Readout id={PROCESS_STEPS[activeIndex]!.id} /></div>
        <p className="process-caption interactive-text">
          {webgl ? "Water, ChemDFT's test geometry. " : ""}A recorded execution, not a live calculation. Fields come from the same stored run throughout.
        </p>
      </div>
    </section>
  );
}
