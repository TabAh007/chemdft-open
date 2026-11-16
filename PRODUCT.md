# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Full implementation stack: the Next.js/FastAPI/PostgreSQL foundation plus strict generated scientific contracts, immutable structure/artifact/provenance/result persistence, renderer-neutral visualization, the trusted-producer Scientific Result Firewall, Compute Gateway job queuing, pinned PySCF 2.14.0 and xTB engines, and the verified AI Scientist orchestration copilot (Batch B4.1–B4.3) with human-in-the-loop approvals, bounded transient recovery, and worker fencing. QCSchema v2 remains the bounded interchange contract; external cloud compute and broader spectroscopy workflows expand incrementally.

## Users

Initial product focus is researchers who need computation and experimental evidence in one traceable project: computational chemists and existing Gaussian/GaussView/ORCA/WebMO users; experimental chemists who need guided computational comparison; graduate/PhD researchers; and university research labs. Materials and petroleum/petrochemical researchers are important secondary audiences whose periodic, XRD, thermal, DLS, and specialized workflows expand incrementally rather than defining all V1 scope.

## Product Purpose

ChemDFT is an AI-native computational chemistry and experimental-analysis workspace in the browser. It lets researchers create/import structures, run deterministic scientific engines, analyze experimental data, connect papers and evidence to project entities, compare calculated and experimental results, preserve provenance, and export reproducible scientific work.

Success means multi-step scientific work becomes easier to plan and inspect without hiding real methods, parameters, failures, costs, artifacts, or uncertainty.

## Positioning

Primary positioning: **Online DFT & Computational Chemistry Software**.

ChemDFT combines an AI Scientist, expert controls, molecular/materials/spectrum workspaces, real calculation engines, deterministic linked visualization, hybrid project knowledge, compute orchestration, and provenance. It is not a Gaussian/WebMO clone, generic chatbot, molecule viewer, DFT form, or vector-only RAG product.

## Operating Context

Researchers work in projects containing samples, versioned structures/conformers, experiments and derived datasets, calculations/results/artifacts, papers/citations/evidence, conversations, and reports. They may begin with natural language or direct controls, move between both without losing settings, and leave long-running jobs to continue durably. Browser desktop/laptop is the professional workstation; tablet/mobile support review, AI conversation, approvals, job monitoring, and simple result inspection.

## Capabilities and Constraints

- AI plans, explains, retrieves, compares, and proposes hypotheses; scientific engines calculate and deterministic renderers visualize.
- The Scientific Result Firewall prevents models and untrusted clients from writing authoritative scientific results.
- AI-first and expert/manual interfaces call the same typed domain actions and permission/budget policies.
- Raw experimental/source data and scientifically meaningful structure versions are preserved.
- Expensive compute uses server-side estimates, reservations, approvals, caps, metering, and cancellation.
- AI providers remain behind the provider-independent Model Gateway; managed AI and BYOK never alter scientific authority.
- Blueprint.js is the only full component framework; ChemDFT supplies the visual system.
- 3Dmol.js and the Three.js Studio renderer consume the same ScientificScene and never alter chemistry for appearance.
- English launches first; Turkish, Russian, and German are planned next.
- WebMCP/MCP/API are adapters over domain actions, not owners of product logic.
- Phase 0 is specification-only: no scaffold, dependency installation, application source, fake metrics, or invented scientific data.

## Brand Commitments

Name: **ChemDFT**. Voice: precise, evidence-aware, calm, direct, and scientifically literate. Product character: light-first professional scientific instrument + IDE + CAD/research workstation; mathematical/technical, dense but legible, with restrained color and no generic AI-SaaS decoration.

Landing promise: **“Computational chemistry, without the old workflow.”** Supporting line: **“Run DFT, analyze experimental data, visualize molecular properties, and work with an AI scientist directly in your browser.”**

## Evidence on Hand

The repository contains the accepted Phase −1 architecture, scientific-integrity rules, threat model, licensing triage, and ADRs. One local scientific PDF exists in the Obsidian workspace but has not been validated or approved as product demonstration content. No testimonials, customers, benchmark results, price points, production screenshots, or scientific demo datasets are available; future work must not fabricate them.

## Product Principles

1. AI-first, never AI-only.
2. Scientific truth and provenance before convenience.
3. One typed action system across language, manual UI, API, WebMCP, and MCP.
4. Preserve originals; version meaningful edits and derived processing.
5. Progressive disclosure without removing expert control.

## Accessibility & Inclusion

Target WCAG 2.2 AA where applicable. Support keyboard-first operation, visible focus, logical reading/tab order, non-color-only status, scalable text, reduced motion, high contrast, and nonvisual/tabular alternatives for spectrum, structure, and linked-selection information. Do not claim full professional molecule/crystal editing is suitable on a phone.
