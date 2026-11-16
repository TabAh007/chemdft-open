# ADR-031: Separate engine preference from execution identity

Status: Accepted

Public specifications carry only `EnginePreference`. Exact engine/adapter/environment identity is issued from worker evidence by trusted server code. This prevents browser, REST, and Tool Registry callers from forging execution truth while preserving explicit deterministic selection.
