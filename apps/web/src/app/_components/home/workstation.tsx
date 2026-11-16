"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { useMediaQuery, usePrefersReducedMotion } from "./use-media";
import { loadGsap } from "./gsap";
import { fixed, RUN, RUN_IDENTITY } from "./run-record";

/** One real captured workspace: its scientific viewport is visible before the surrounding interface opens. */
export function Workstation() {
  const root = useRef<HTMLElement>(null);
  const reduced = usePrefersReducedMotion();
  const desktop = useMediaQuery("(min-width: 1000px)");
  useEffect(() => {
    const section = root.current;
    if (!section || reduced || !desktop) return;
    let cancelled = false;
    let revert: (() => void) | undefined;
    void (async () => {
      const { gsap } = await loadGsap();
      if (cancelled) return;
      const context = gsap.context(() => {
        const frame = section.querySelector(".workstation-frame");
        const origin = section.querySelector(".workstation-origin");
        section.dataset.reveal = "active";
        const timeline = gsap.timeline({ scrollTrigger: {
          trigger: section.querySelector(".workstation-reveal"), start: "top top+=54", end: "+=50%", scrub: 0.15,
          onUpdate: (self) => { section.dataset.progress = self.progress.toFixed(3); },
        } });
        timeline.fromTo(frame, { clipPath: "inset(34% 39% 18% 34%)", opacity: 0 }, { clipPath: "inset(0% 0% 0% 0%)", opacity: 1, ease: "none", duration: 1 }, 0);
        timeline.to(origin, { opacity: 0, ease: "none", duration: 0.25 }, 0.12);
      }, section);
      revert = () => context.revert();
    })();
    return () => { cancelled = true; revert?.(); delete section.dataset.reveal; delete section.dataset.progress; };
  }, [reduced, desktop]);

  return (
    <section ref={root} className="workstation" id="workstation" aria-labelledby="workstation-title">
      <header className="workstation-head">
        <p className="eyebrow">The workstation</p>
        <h2 id="workstation-title">Structure, numbers and evidence in one workspace</h2>
        <p className="run-identity">{RUN_IDENTITY} · stored calculation</p>
        <p>The same stored run, opened in ChemDFT&apos;s Guided electronic-structure workspace.</p>
      </header>
      <figure className="workstation-figure">
        <div className="workstation-reveal">
          <div className="workstation-stage">
            <div className="workstation-origin" aria-hidden="true" data-testid="workstation-scientific-origin">
              <Image src="/product/workstation-water-homo.webp" alt="ChemDFT Guided electronic-structure workstation background illustration showing water molecular orbital analysis" width={2400} height={1500} sizes="(max-width: 1560px) 92vw, 1440px" />
            </div>
            <div className="workstation-frame" data-testid="workstation-frame">
              <div className="workstation-mobile-context"><strong>ChemDFT</strong><span>Guided · Electronic structure</span></div>
              <div className="workstation-image-window">
                <Image src="/product/workstation-water-homo.webp"
                  alt="ChemDFT's real Guided workspace for water, HF/STO-3G: selected HOMO, orbital viewport, navigation and scientific values. Total SCF energy −74.962928 hartree, HOMO −0.3912, LUMO 0.6057 and orbital-energy gap 0.9969 hartree."
                  width={2400} height={1500} sizes="(max-width: 999px) 760px, (max-width: 1560px) 92vw, 1440px" />
              </div>
              <div className="workstation-mobile-readout">
                <strong>HOMO · MO {RUN.result.homo.index}</strong>
                <dl>
                  <div><dt>Total SCF energy</dt><dd>{fixed(RUN.result.total_energy_hartree, 6)} Eh</dd></div>
                  <div><dt>HOMO energy</dt><dd>{fixed(RUN.result.homo.energy_hartree, 4)} Eh</dd></div>
                  <div><dt>LUMO energy</dt><dd>{fixed(RUN.result.lumo.energy_hartree, 4)} Eh</dd></div>
                  <div><dt>Orbital-energy gap</dt><dd>{fixed(RUN.result.gap_hartree, 4)} Eh</dd></div>
                </dl>
                <p>Orbital-energy difference, not an optical excitation energy.</p>
              </div>
            </div>
          </div>
        </div>
        <figcaption>Real ChemDFT workspace capture · stored water · HF/STO-3G.</figcaption>
      </figure>
    </section>
  );
}
