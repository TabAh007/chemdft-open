"use client";

import { useEffect, useRef } from "react";

import { AI_MAY, AI_MAY_NOT, FIREWALL_CHAIN } from "./content";
import { usePrefersReducedMotion } from "./use-media";
import { RUN_IDENTITY } from "./run-record";
import { loadGsap } from "./gsap";

/**
 * Act III — the single dark act. The result firewall is drawn as a structure, not as cards: a row of five stations on one
 * hairline, with the platform's deterministic stretch bracketed. GSAP + ScrollTrigger reveal it station by station as it
 * scrolls into view (scrubbed, never pinned); with reduced motion it is simply all there.
 */
export function Firewall() {
  const root = useRef<HTMLElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const section = root.current;
    if (!section || reduced) return;
    let cancelled = false;
    let revert: (() => void) | undefined;
    void (async () => {
      const { gsap } = await loadGsap();
      if (cancelled) return;
      const context = gsap.context(() => {
        const nodes = gsap.utils.toArray<HTMLElement>(".chain-node", section);
        gsap.fromTo(section, { "--proof-bg": "#1b2835" }, { "--proof-bg": "#101a24", ease: "none", scrollTrigger: { trigger: section, start: "top 95%", end: "top 65%", scrub: true } });
        const bracket = section.querySelector(".chain-bracket");
        const timeline = gsap.timeline({ scrollTrigger: { trigger: section.querySelector(".chain"), start: "top 82%", end: "top 38%", scrub: 0.4 } });
        timeline.fromTo(section, { "--proof-progress": 0 }, { "--proof-progress": 1, ease: "none", duration: 1.6 });
        timeline.fromTo(nodes, { "--draw": 0 }, { "--draw": 1, stagger: 0.28, ease: "none", duration: 0.5 }, 0.12);
        if (bracket) timeline.fromTo(bracket, { scaleX: 0 }, { scaleX: 1, transformOrigin: "left center", ease: "none", duration: 1 }, 0.4);
      }, section);
      revert = () => context.revert();
    })();
    return () => {
      cancelled = true;
      revert?.();
    };
  }, [reduced]);

  return (
    <section ref={root} className="firewall" id="result-firewall" aria-labelledby="firewall-title">
      <div className="firewall-inner">
        <header className="firewall-head">
          <p className="eyebrow">Scientific Result Firewall</p>
          <h2 id="firewall-title">AI may explain a scientific result. It cannot replace the calculation that produced it.</h2>
          <p>
            Authoritative values come from deterministic scientific engines and validated outputs, each stored with its calculation source: method, basis set, engine and engine version. The model works through the same typed
            actions as a person and has no way to write a result.
          </p>
        </header>

        <div className="chain-wrap">
          <p className="chain-bracket-label" aria-hidden="true">
            Platform · deterministic · the only path that writes a result
          </p>
          <span className="chain-bracket" aria-hidden="true" />
          <ol className="chain" aria-label="How a result reaches the AI Scientist">
            {FIREWALL_CHAIN.map((node, index) => (
              <li key={node.id} className="chain-node" data-kind={node.kind}>
                <span className="chain-lane">{node.kind === "ai" ? "AI" : "Platform"}</span>
                <strong>{node.label}</strong>
                <span className="chain-note">{node.note}</span>
                {node.id === "result" ? <span className="chain-run" data-testid="firewall-run-identity">{RUN_IDENTITY}<br />Stored · calculated · not reviewed</span> : null}
                <span className="chain-index" aria-hidden="true">
                  {index + 1}
                </span>
                {index < FIREWALL_CHAIN.length - 1 ? <i className="chain-arrow" aria-hidden="true" /> : null}
              </li>
            ))}
          </ol>
        </div>

        <div className="firewall-rules">
          <div>
            <h3>The AI Scientist can</h3>
            <ul className="mark-list" data-mark="yes">
              {AI_MAY.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>The AI Scientist cannot</h3>
            <ul className="mark-list" data-mark="no">
              {AI_MAY_NOT.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="firewall-note">The firewall restricts who can write results; it does not certify that a method is right for your system. Choosing and judging a method remains scientific work.</p>
      </div>
    </section>
  );
}
