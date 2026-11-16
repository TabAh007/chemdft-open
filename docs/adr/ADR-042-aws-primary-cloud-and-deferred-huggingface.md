# ADR-042: AWS as primary cloud platform; Hugging Face as deferred backup

Status: Accepted. Date: 2026-10-15. Authority: the user's strategic decision in the
2026-10-15 documentation consolidation. Relationship: **qualifies, does not supersede,
[ADR-009](ADR-009-compute-gateway-modal-first.md)**, which remains the accepted
historical Compute Gateway decision (provider-independent, Modal first).

## Context

ChemDFT needs a real Linux scientific environment to validate PySCF and xTB and to run a
private first worker. The user reports about $90 of AWS promotional credits expiring in about
90 days (a user report, not verified against AWS Billing) and an existing paid Hugging Face
subscription with a CPU environment of about 16 GB RAM (also unverified).

## Decision

1. **AWS is the primary cloud platform** for current engineering, in us-east-1, through the
   prepared CloudFormation stack `chemdft-ec2-pilot` (one `m7i-flex.large`, encrypted 40 GiB
   gp3, SSM-only access, no inbound application ports). The pilot hosts the **existing local
   Compute Gateway provider** on EC2; it is not a new remote provider adapter, adds no ADR-009
   supersession and does not remove Modal, which stays a historical/planned adapter target.
2. **Promotional credits do not replace spending controls.** The two-hour session limit, the
   Lambda shutdown guard, the DynamoDB hour ledger, the monthly admission ceiling (initially 25
   hours = 24 reserved hours), alarms and the existing $10/month `ChemDFT-Monthly-Budget`
   notification threshold remain mandatory; AWS Budgets are not a hard cap and the budget is
   not raised automatically. Project tag activation and budget contents stay unverified.
3. **Hugging Face is a BACKUP scientific compute platform, status DEFERRED** (Priority I): no
   Space, Job, deployment or spending now. Spaces and Jobs are different services; entitlements,
   hardware, storage persistence, timeouts, privacy, Docker compatibility, engine installation,
   licenses, artifact retention and cost must be verified at the time of future use.
4. **Five Hugging Face-hosted model families are DEFERRED** and not integrated: IBM MoLFormer,
   MACE-MP, Microsoft MatterGen, AllenAI SPECTER2 and BAAI BGE-M3 (details and prerequisites in
   the registry). No model is downloaded, no dependency added and no
   inference run. ML predictions are never equivalent to authoritative engine calculations.
5. **Working product first, new capabilities second.** Development priorities A–I are recorded
   in the [roadmap](../14_ROADMAP.md) as priorities, not replacement phases; existing phase
   numbers are unchanged.
6. **Nothing is deployed.** The AWS pilot is BLOCKED until a dedicated ChemDFT identity exists
   (never root, never an unrelated project credentials) and the listed gates close; an unrelated project is never
   modified. User approvals remain required for provisioning, builds, Linux runs, NVIDIA
   requests and any Hugging Face activity.

## Consequences

* A reader of ADR-009 must also read this ADR: AWS is where cloud work happens now; Modal is not
  rejected. A future AWS remote adapter needs its own design and, if it replaces Modal as the first
  planned remote adapter, a separate superseding ADR.
* Credits expiring creates schedule pressure that must not weaken IAM, shutdown or cost gates.
* Hugging Face and the five models stay out of dependency manifests until a prerequisite
  evaluation is authorized.
