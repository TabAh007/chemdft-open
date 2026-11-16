# Final blind holdout V3 result

Status: **COMPLETED, FINAL**. One claimed evaluation; no retuning or rerun.

The canonical output root was verified as `/private/tmp/chemdft-blind-v3-one-shot` with no symlink components. The complete precheck passed without ranking. All frozen SHA-256 identities, V3 file hashes, preservation hashes, model revision, adapted schema, counts, absence of a prior completed result, and output writability were verified.

## Frozen identities

| Item | SHA-256 |
| --- | --- |
| Policy | `70b06bf55aa8a312ee82fac8bd79321fcb4c9ec9b658ff30562ed4af3aa6f166` |
| Evaluator | `a65107e31052d109b5a47c014035910905d0b4d597e7ccdc9400c13b6c03b0fa` |
| Adapter | `0a12c995bcbc736016a376cdc1d36fb21d3734625a4dd7a36b134c7727f6a14c` |
| V3 package | `2fdfaaa432ba9f47a53d394c78fe4acbb1bf569c955b22ba2d3fa1eb863f08f9` |
| Adapted evaluator package | `27527a000fef781b545d7532bf5e3d5e77af2be101986a97d02290e17fb9f595` |
| Final scientific result | `f06ca2103779766db5a8cfcfb4f2677534f32ef242c43292d9d29e5562c46f5b` |

Counts: 37 retained QRELs (28 answerable, 9 no-answer); 5 sources; 147 chunks.

## Retrieval metrics

Recall uses target hits / 37 acceptable targets. Document and chunk hit rates use 28 answerable queries. MRR and nDCG@5 are means over answerable queries.

| k | Recall | Document hit | Chunk hit |
| --- | --- | --- | --- |
| 1 | 21/37 (0.5676) | 27/28 (0.9643) | 21/28 (0.7500) |
| 3 | 29/37 (0.7838) | 28/28 (1.0000) | 26/28 (0.9286) |
| 5 | 29/37 (0.7838) | 28/28 (1.0000) | 26/28 (0.9286) |

MRR: **0.8393**. nDCG@5: **0.8144**.

## Abstention

| Measure | V3 |
| --- | --- |
| No-answer false accepts | 7/9 (0.7778) |
| Correct abstains | 2/9 |
| Answerable accepted | 24/28 (0.8571) |
| SAFE_RECALL@5 | 23/28 (0.8214) |

## Frozen slices

Rates below apply to answerable queries in each slice. Target recall uses target counts within the slice.

| Slice | Answerable | Accepted | Chunk hit@5 | SAFE_RECALL@5 | Target recall@5 | MRR |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| language: English | 23 | 0.8696 | 0.9565 | 0.8696 | 0.8000 | 0.8478 |
| language: cross-language | 5 | 0.8000 | 0.8000 | 0.6000 | 0.7143 | 0.8000 |
| query_class: formula | 1 | 1.0000 | 1.0000 | 1.0000 | 0.2000 | 0.5000 |
| query_class: identifier | 2 | 0.5000 | 1.0000 | 0.5000 | 1.0000 | 0.7500 |
| query_class: method/basis | 3 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0.8333 |
| query_class: numeric | 7 | 0.8571 | 1.0000 | 0.8571 | 0.8889 | 0.9286 |
| query_class: other | 12 | 0.8333 | 0.8333 | 0.7500 | 0.8000 | 0.8333 |
| query_class: semantic/paraphrase | 3 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0.8333 |

## DEV vs V3 descriptive deltas

The DEV baseline is the frozen evaluator 1.1.0 real-model DEV qualification using the same fixed threshold and metric formulas. DEV has 50 answerable and 21 no-answer queries in a different six-source corpus. These differences are descriptive; slice sample sizes are small. The historical DEV policy-selection report uses different recall/MRR aggregation and out-of-fold abstention, so it is not used for these deltas.

| Metric | DEV | V3 | V3 − DEV |
| --- | ---: | ---: | ---: |
| recall_at_1 | 0.6207 | 0.5676 | -0.0531 |
| recall_at_3 | 0.7759 | 0.7838 | +0.0079 |
| recall_at_5 | 0.8448 | 0.7838 | -0.0610 |
| document_hit_at_1 | 0.9800 | 0.9643 | -0.0157 |
| document_hit_at_3 | 0.9800 | 1.0000 | +0.0200 |
| document_hit_at_5 | 0.9800 | 1.0000 | +0.0200 |
| chunk_hit_at_1 | 0.7200 | 0.7500 | +0.0300 |
| chunk_hit_at_3 | 0.8800 | 0.9286 | +0.0486 |
| chunk_hit_at_5 | 0.9400 | 0.9286 | -0.0114 |
| mrr | 0.8107 | 0.8393 | +0.0286 |
| ndcg_at_5 | 0.8282 | 0.8144 | -0.0138 |
| no_answer_false_accept_rate | 0.0952 | 0.7778 | +0.6825 |
| answerable_acceptance_rate | 0.8400 | 0.8571 | +0.0171 |
| safe_recall_at_5 | 0.7800 | 0.8214 | +0.0414 |

Matching language and query-class deltas, with denominators, are in `final-report.json`.

**BLIND_GENERALIZATION_GATE = NOT_PREDECLARED**

State transitions: PRECHECK → CLAIMED → SCORING → RESULT_WRITTEN → COMPLETED. Immutable journal records and the exact scientific result are copied alongside this report.
