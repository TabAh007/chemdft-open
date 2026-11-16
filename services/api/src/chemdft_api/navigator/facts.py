"""Immutable projections, not ORM entities or scientific artifact bodies."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class StructureFacts:
    id: str
    structure_id: str
    name: str
    kind: str
    dimensionality: int | None
    atom_count: int
    charge: int | None
    multiplicity: int | None
    lattice: bool
    origin: str
    canonical_hash: str
    provenance: bool
    composition: str = ""
    conformers: int = 0


@dataclass(frozen=True, slots=True)
class ResultFacts:
    id: str
    calculation_id: str
    version_id: str
    schema: str
    task: str
    method: str
    basis: str
    engine: str
    converged: bool
    energy: bool = False
    orbitals: bool = False
    frontier: bool = False
    ir: bool = False
    raman: bool = False
    modes_valid: bool = False
    imaginary: bool = False
    hessian: bool = False
    input_hash: str | None = None
    charge: int | None = None
    multiplicity: int | None = None
    temperature: float | None = None
    pressure: float | None = None
    final_version_id: str | None = None
    coefficients: bool = False
    provenance: bool = False
    final_hash: str | None = None


@dataclass(frozen=True, slots=True)
class JobFacts:
    id: str
    version_id: str
    task: str
    state: str


@dataclass(frozen=True, slots=True)
class OptimizationFacts:
    calculation_id: str
    final_version_id: str
    converged: bool
    gradient_rms: float | None


@dataclass(frozen=True, slots=True)
class SpectrumFacts:
    id: str
    technique: str
    associated_structure_id: str | None
    processed: bool
    peak_set: bool = False


@dataclass(frozen=True, slots=True)
class ProjectFacts:
    project_id: str
    structure: StructureFacts | None = None
    results: tuple[ResultFacts, ...] = ()
    jobs: tuple[JobFacts, ...] = ()
    optimizations: tuple[OptimizationFacts, ...] = ()
    spectra: tuple[SpectrumFacts, ...] = ()
    comparisons: tuple[tuple[str, str, str], ...] = ()
    grid_types: tuple[str, ...] = ()
    documents: int = 0
    imported_results: int = 0
    candidates: int = 0
    history_complete: bool = True


@dataclass(frozen=True, slots=True)
class Capabilities:
    tasks: frozenset[str] = frozenset()
    optimizer: bool = False
