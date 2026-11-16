import errno
import os
import stat
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

MAX_SECRET_FILE_BYTES = 8192


class SecretFileError(ValueError):
    """Unsafe or unreadable secret file. Messages never contain file content."""


def read_secret_file(path: Path) -> str:
    """Read one single-line credential from a private regular file, failing closed.

    The final path component must not be a symlink, the file must be a regular,
    single-link file owned by the running user with no group/other permissions,
    and its size and content must be bounded. The file is checked through the
    opened descriptor, so a swap between check and read cannot bypass the test.
    """
    if os.name != "posix":
        raise SecretFileError("Secret files are supported only on POSIX hosts.")
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
    except FileNotFoundError:
        raise SecretFileError(f"Configured secret file does not exist: {path}") from None
    except OSError as error:
        # ELOOP is raised by O_NOFOLLOW for a symlink; no content was read.
        reason = "is a symbolic link" if error.errno == errno.ELOOP else "is unreadable"
        raise SecretFileError(f"Configured secret file {reason}: {path}") from None
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise SecretFileError(f"Secret file must be a regular single-link file: {path}")
        if info.st_uid != os.geteuid():
            raise SecretFileError(f"Secret file must be owned by the running user: {path}")
        if info.st_mode & 0o077:
            raise SecretFileError(f"Secret file must have no group/other access (0600): {path}")
        if not 1 <= info.st_size <= MAX_SECRET_FILE_BYTES:
            raise SecretFileError(f"Secret file must be 1 to {MAX_SECRET_FILE_BYTES} bytes: {path}")
        raw = os.read(descriptor, MAX_SECRET_FILE_BYTES + 1)
    finally:
        os.close(descriptor)
    try:
        value = raw.decode("utf-8").strip()
    except UnicodeDecodeError:
        raise SecretFileError(f"Secret file is not valid UTF-8: {path}") from None
    if not value or not value.isprintable() or any(character.isspace() for character in value):
        raise SecretFileError(f"Secret file must contain exactly one credential token: {path}")
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CHEMDFT_", env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./.chemdft/chemdft.db"
    object_root: Path = Path("./.chemdft/objects")
    auto_create_schema: bool = False
    # Deployment environment. The fixed development identity only operates in an explicitly
    # local one (see `auth.dev_identity_permitted`); anything else, or any hosted-platform
    # marker, refuses it.
    environment: str = "development"
    # Authentication boundary. "dev": the fixed local development identity (local only).
    # "jwt": a short-lived signed token minted by the trusted web layer, verified here against JWKS.
    auth_mode: str = "dev"
    auth_issuer: str | None = None
    auth_audience: str | None = None
    auth_jwks_url: str | None = None
    auth_jwks_json: str | None = None  # static key set for offline/test use; never a private key
    auth_jwt_algorithms: str = "EdDSA"
    auth_jwt_leeway_seconds: int = Field(default=10, ge=0, le=120)
    auth_jwks_cache_seconds: int = Field(default=3600, ge=30, le=86_400)
    # Pre-launch administration: ChemDFT HUMAN accounts (by exact email) allowed to run legacy
    # ownership operations through the operator CLI. Empty by default: nobody is an administrator,
    # there is no "first user" rule and nothing is guessed from an email domain.
    bootstrap_admin_emails: str = ""
    dev_identity_enabled: bool = False
    dev_identity_header_override_enabled: bool = False
    dev_user_id: str = "00000000-0000-4000-8000-000000000001"
    dev_organization_id: str = "00000000-0000-4000-8000-000000000010"
    max_upload_bytes: int = Field(default=100 * 1024 * 1024, gt=0)
    # Direct browser-to-API PDF upload (see direct_upload.py). Off unless all three are set.
    direct_upload_public_url: str | None = None
    direct_upload_allowed_origin: str | None = None
    upload_ticket_secret: str | None = None
    direct_upload_ticket_seconds: int = Field(default=600, ge=60, le=3600)
    pdf_parse_timeout_seconds: int = Field(default=30, ge=1, le=300)
    experimental_max_points: int = Field(default=200_000, ge=1, le=2_000_000)
    scientific_worker_python: Path = Path("./services/scientific-worker/.venv/bin/python")
    # External Computational Import V1: isolated parser environment
    # (pinned cclib wheel; see services/import-worker)
    import_worker_python: Path = Path("./services/import-worker/.venv/bin/python")
    import_worker_source: Path = Path("./services/import-worker/src")
    max_import_bytes: int = Field(default=64 * 1024 * 1024, gt=0)
    import_parse_wall_seconds: int = Field(default=120, ge=1, le=900)
    import_parse_cpu_seconds: int = Field(default=90, ge=1, le=900)
    import_parse_memory_bytes: int = Field(default=2 * 1024 * 1024 * 1024, ge=64 * 1024 * 1024)
    # Experimental spectra V1: isolated numpy/scipy/pybaselines env (services/spectra-worker)
    spectra_worker_python: Path = Path("./services/spectra-worker/.venv/bin/python")
    spectra_worker_source: Path = Path("./services/spectra-worker/src")
    max_spectrum_bytes: int = Field(default=32 * 1024 * 1024, gt=0)
    spectra_wall_seconds: int = Field(default=60, ge=1, le=600)
    spectra_cpu_seconds: int = Field(default=45, ge=1, le=600)
    spectra_memory_bytes: int = Field(default=1024 * 1024 * 1024, ge=64 * 1024 * 1024)
    # Molecular diagram recognition (Batch B2): DECIMER runs only in this isolated environment
    # (services/reconstruction-evaluation); TensorFlow is never imported into the API process.
    decimer_worker_python: Path = Path("./services/reconstruction-evaluation/.venv/bin/python")
    decimer_model_cache: Path = Path.home() / ".data"
    decimer_wall_seconds: int = Field(default=180, ge=5, le=900)
    decimer_cpu_seconds: int = Field(default=600, ge=5, le=3600)
    # The development recognition engine is a hint-driven lookup, not a model. It is refused
    # unless this flag is set AND the environment is local; never enable it for researchers.
    recognition_development_engine_enabled: bool = False
    xtb_executable: Path | None = Path("./.chemdft/envs/xtb/bin/xtb")
    crest_executable: Path | None = Path(
        "./.chemdft/envs/crest-3.0.2-ewinfix-a1/bin/crest-pf8c-ewinfix"
    )
    # Leave unset in normal use: see `effective_crest_lock_path` (hosted default is under the writable object dir).
    crest_lock_path: Path = Path("./.chemdft/locks/crest.lock")
    crest_max_output_bytes: int = Field(default=16 * 1024 * 1024, ge=1024, le=64 * 1024 * 1024)
    crest_max_scratch_bytes: int = Field(default=512 * 1024 * 1024, ge=1024, le=1024 * 1024 * 1024)
    crest_max_retained_bytes: int = Field(default=64 * 1024 * 1024, ge=1024, le=128 * 1024 * 1024)
    crest_min_free_bytes: int = Field(default=2 * 1024 * 1024 * 1024, ge=0)
    crest_timeout_seconds: int = Field(default=1800, ge=1, le=3600)
    psi4_executable: Path | None = None
    dftd4_executable: Path | None = None
    scientific_execution_timeout_seconds: int = Field(default=180, ge=10, le=3600)
    scientific_max_atoms: int = Field(default=100, ge=1, le=1000)
    scientific_max_output_bytes: int = Field(default=5 * 1024 * 1024, ge=1024)
    scientific_threads: int = Field(default=1, ge=1, le=16)
    compute_default_provider: str = "local"
    compute_lease_seconds: int = Field(default=300, ge=30, le=86_400)
    compute_heartbeat_seconds: int = Field(default=60, ge=5, le=3_600)
    knowledge_lease_seconds: int = Field(default=300, ge=30, le=86_400)
    investigation_lease_seconds: int = Field(default=120, ge=10, le=86_400)
    investigation_poll_seconds: float = Field(default=2.0, ge=0.1, le=60)
    knowledge_heartbeat_seconds: int = Field(default=60, ge=5, le=3_600)
    knowledge_max_chunks_per_batch: int = Field(default=64, ge=1, le=10_000)
    knowledge_max_attempts: int = Field(default=3, ge=1, le=10)
    compute_local_memory_bytes: int = Field(default=2 * 1024 * 1024 * 1024, ge=134_217_728)
    compute_local_temporary_storage_bytes: int = Field(default=1024 * 1024 * 1024, ge=0)
    compute_modal_enabled: bool = False
    compute_modal_app_name: str = "chemdft-pyscf"
    compute_modal_function_name: str = "run_pyscf_energy"
    # Experimental, session-based AWS EC2 execution. Off by default; LOCAL stays the default
    # provider. Starting EC2 is never done by the application (see aws_session_control).
    # Hosted backends run no scientific engine: local calculations are refused (not queued to fail).
    compute_local_enabled: bool = True
    compute_aws_enabled: bool = False
    # The hosted compute image ships WITHOUT geomeTRIC (licence field-of-use clause). A self-hoster whose own image
    # installs the 'optimization' extra sets this true to re-enable PySCF geometry optimisation on the AWS path.
    compute_aws_geometric_available: bool = False
    aws_config_file: Path | None = None
    aws_pilot_bucket: str | None = None
    aws_instance_id: str | None = None
    aws_image_id: str | None = None
    aws_session_file: Path | None = None
    # Hosted backend: credentials come from the instance role (via a refreshed credentials file),
    # the session record is published to S3 by the owner's tool, and no guard access exists at all.
    aws_credential_mode: str = "login_profile"  # or "instance_role"
    aws_credentials_file: Path | None = None
    aws_backend_role_name: str = "chemdft-backend-instance-role"
    aws_session_s3_key: str | None = None
    aws_session_publish: bool = False  # owner's Mac: also publish/close the S3 record
    aws_guard_poll_enabled: bool = True
    aws_queue_without_session: bool = False  # queue AWS jobs until the owner opens a session
    # On-demand worker (see aws_worker_lifecycle): the compute worker asks the guard to start the
    # scientific worker for waiting approved jobs; the host powers itself off after 15 idle minutes.
    aws_on_demand_enabled: bool = False
    aws_worker_state_file: Path | None = None  # shared volume: startup state for the API process
    aws_boot_grace_seconds: int = Field(default=150, ge=60, le=900)
    aws_start_timeout_seconds: int = Field(default=600, ge=120, le=1_800)
    aws_start_failure_hold_seconds: int = Field(default=900, ge=300, le=7_200)
    aws_lifecycle_poll_seconds: float = Field(default=10.0, ge=5, le=60)  # while jobs wait
    aws_lifecycle_idle_poll_seconds: float = Field(default=60.0, ge=30, le=300)
    aws_max_queued_jobs: int = Field(default=5, ge=1, le=50)  # admission limit for waiting AWS jobs
    # An approved AWS job that has waited longer than this is STALE: it never starts the worker and is
    # never claimed (the researcher resubmits). Prevents days-old jobs from running unexpectedly.
    aws_job_max_wait_seconds: int = Field(default=6 * 3600, ge=900, le=7 * 86_400)
    aws_pyscf_version: str = "2.14.0"
    aws_xtb_version: str = "6.7.1"
    # Hosted PySCF geometry optimization (implemented, NOT yet executed on AWS): its own wall-clock
    # limit and atom ceiling; the global scientific_execution_timeout_seconds still bounds ENERGY.
    aws_optimization_timeout_seconds: int = Field(default=600, ge=10, le=3600)
    aws_optimization_max_atoms: int = Field(default=12, ge=1, le=100)
    # xTB ANCopt on <= 12 atoms finishes in seconds to a minute; 300 s bounds the spend (~$0.008 at list price).
    # Raised 300 -> 900 s with the 50-atom ceiling (0.0.11): a 39-44 atom GFN2 ANCopt is not a seconds job.
    aws_xtb_optimization_timeout_seconds: int = Field(default=900, ge=10, le=3600)
    # Hosted PySCF single points: B3LYP/def2-SVP on 39-44 atoms ran past the old 180 s global limit.
    aws_energy_timeout_seconds: int = Field(default=1800, ge=10, le=3600)
    aws_frequency_timeout_seconds: int = Field(default=600, ge=10, le=3600)
    aws_frequency_max_atoms: int = Field(default=6, ge=1, le=100)
    aws_orbital_max_atoms: int = Field(default=12, ge=1, le=100)
    aws_tddft_timeout_seconds: int = Field(default=600, ge=10, le=3600)
    aws_tddft_max_atoms: int = Field(default=6, ge=1, le=100)
    aws_xtb_max_atoms: int = Field(default=50, ge=1, le=100)
    # Hosted CREST (Linux x86_64 build of the patched source, built on the worker host). The binary
    # digest is deployment configuration recorded at build time; without it CREST stays unavailable.
    # crest.py reads the same CHEMDFT_AWS_CREST_BINARY_SHA256 variable for its accepted-digest set.
    aws_crest_binary_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    aws_crest_timeout_seconds: int = Field(default=900, ge=10, le=3600)
    aws_crest_max_atoms: int = Field(default=12, ge=1, le=50)
    aws_tddft_max_states: int = Field(default=10, ge=1, le=100)
    # Hosted periodic DFT (PySCF PBC single-point energy and electronic structure).
    # Never above what the worker host accepts for the pyscf engine (host-workflow.sh MAX_TIMEOUT_SECONDS=3600);
    # a larger request is refused by the host at launch ("invalid timeout"). Measured on the hosted machine
    # (m7i-flex.large): Gamma, 10 atoms = 1009 s.
    aws_periodic_timeout_seconds: int = Field(default=3600, ge=60, le=3600)
    aws_periodic_max_atoms: int = Field(default=20, ge=1, le=200)
    # PySCF uses every k-point of a mesh (no symmetry reduction): Gamma already takes 1009 s hosted, so 2x2x2 (8 k-points) is
    # expected to exceed the one-hour cap and was NOT measured. Bigger meshes: Quantum ESPRESSO (aws_qe_*).
    aws_periodic_allowed_kmeshes: str = "1x1x1"
    aws_periodic_max_scratch_bytes: int = Field(
        default=10 * 1024 * 1024 * 1024, ge=1024 * 1024 * 1024
    )
    aws_periodic_max_memory_mb: int = Field(default=5500, ge=1024, le=16384)
    # Quantum ESPRESSO plane-wave periodic DFT (release 0.0.43). Local: QE binaries and the SSSP library are found
    # under these directories; the engine is offered only when pw.x, projwfc.x, dos.x, bands.x and mpirun are all
    # present. Hosted: the pinned image carries QE 7.6 and the SSSP files; it stays OFF until the owner has built and
    # tested the image (CHEMDFT_AWS_QE_ENABLED=true). Limits are measured on the 2 vCPU / 8 GB class.
    qe_bin_dir: Path | None = None
    qe_pseudo_dir: Path | None = None
    aws_qe_enabled: bool = False
    aws_qe_version: str = "7.6"
    aws_qe_max_atoms: int = Field(default=20, ge=1, le=200)
    aws_qe_max_scf_k: int = Field(default=4, ge=1, le=8)
    aws_qe_max_dos_k: int = Field(default=6, ge=1, le=12)
    aws_qe_max_band_points: int = Field(default=100, ge=2, le=400)
    aws_qe_relax_max_steps: int = Field(default=30, ge=1, le=30)
    aws_qe_timeout_scf_seconds: int = Field(default=1800, ge=60, le=3600)
    aws_qe_timeout_relax_seconds: int = Field(default=3600, ge=60, le=3600)
    aws_qe_timeout_nscf_dos_seconds: int = Field(default=1800, ge=60, le=3600)
    aws_qe_timeout_bands_seconds: int = Field(default=1800, ge=60, le=3600)
    aws_qe_timeout_total_seconds: int = Field(default=3600, ge=60, le=3600)
    aws_qe_max_memory_mb: int = Field(default=6000, ge=1024, le=7500)
    aws_qe_max_scratch_bytes: int = Field(default=6 * 1024**3, ge=1024**3)
    # Total executions one AWS job may start; a lost lease is re-queued only while below this.
    aws_max_attempts: int = Field(default=2, ge=1, le=5)
    aws_job_overhead_seconds: int = Field(default=300, ge=60, le=1_800)
    aws_poll_seconds: float = Field(default=5.0, ge=0.5, le=60)
    ai_provider: str = "fake"
    ai_model_fast: str = "gpt-4o-mini"
    ai_model_standard: str = "gpt-4o"
    ai_model_reasoning: str = "o3-mini"
    # Development/test eligibility (AI-6): comma-separated NVIDIA model identifiers this server may
    # offer for the planning profiles their registry row has hosted evidence for, although the row
    # is not yet tool-verified for normal selection. Empty (the default) changes nothing. A model
    # must ALSO be configured as the fast, standard or reasoning model above; nothing is added to
    # the three-model limit and nothing is ever used as a fallback.
    ai_development_models: str = ""
    ai_api_key: SecretStr | None = None
    ai_api_key_file: Path | None = None
    # Direct Moonshot (Kimi) as a second managed provider beside the primary one. Off unless a key
    # (file) AND an operator model list are set; a listed model is still offered only when its
    # registry row holds hosted evidence and AVAILABLE status. Nothing here is ever a fallback.
    moonshot_api_key: SecretStr | None = None
    moonshot_api_key_file: Path | None = None
    moonshot_models: str = ""
    # Honoured only in the isolated test environment and only for loopback (a stand-in); anything
    # else is ignored and the real Moonshot endpoint is used.
    moonshot_api_base_url: str = "https://api.moonshot.ai/v1"
    ai_api_base_url: str = "https://api.openai.com/v1"
    ai_max_tokens_per_run: int = Field(default=16_384, ge=256, le=200_000)
    ai_max_tool_steps: int = Field(default=10, ge=1, le=50)
    # Refused calculation proposals the model may correct before the run ends with the real
    # blocker (so 2 allows three proposals). The run's token and call budgets still apply.
    ai_max_proposal_repairs: int = Field(default=2, ge=0, le=10)
    ai_timeout_seconds: int = Field(default=60, ge=5, le=600)
    # INPUT_RESERVATION_V1 (ai/token_policy.py): UTF-8 bytes of the exact request divided by this
    # floor, plus fixed framing allowances, is the input quota reserved before dispatch. 1.0 is the
    # most conservative fallback (one token per byte); 2.0 is a calibrated allowance. Neither is a
    # guaranteed bound and neither was measured against the hosted tokenizer/chat template. A run
    # that ever sees provider-reported input above its reservation reverts to 1.0.
    ai_input_bytes_per_token_floor: float = Field(default=2.0, ge=1.0, le=8.0)
    run_ai_integration: bool = False
    billing_enabled: bool = False
    # Private-beta guards (0 = unlimited). Counted per user over the last 24 hours; not billing.
    beta_max_ai_runs_per_user_day: int = Field(default=0, ge=0, le=100_000)
    beta_max_compute_jobs_per_user_day: int = Field(default=0, ge=0, le=100_000)
    # Open signup (ADR-045). OFF: no self-service account is provisioned. The web layer has its own switch.
    signup_open: bool = False
    # AI for self-signup accounts stays OFF until the provider-terms gate is cleared by the owner.
    ai_for_new_users: bool = False
    # Quotas for SELF-SIGNUP accounts only (accounts with an account_profiles row); 0 = unlimited.
    # The owner and invited researchers are not counted (they have no profile row).
    quota_jobs_per_day: int = Field(default=5, ge=0, le=100_000)
    quota_jobs_per_month: int = Field(default=40, ge=0, le=1_000_000)
    quota_ai_runs_per_day: int = Field(default=20, ge=0, le=100_000)
    quota_concurrent_jobs: int = Field(default=2, ge=0, le=1_000)
    quota_max_projects: int = Field(default=5, ge=0, le=100_000)
    quota_storage_mb: int = Field(default=200, ge=0, le=10_000_000)
    quota_upload_mb: int = Field(default=25, ge=0, le=10_000)
    billing_default_currency: str = "USD"
    billing_plan_definitions_json: str = "{}"
    billing_webhook_secret: str | None = None
    billing_provider: str = "fake"
    billing_allowance_period_days: int = Field(default=30, ge=1, le=366)
    billing_byok_secret_provider: str = "unconfigured"
    byok_local_root: Path = Path("./.chemdft/byok-secrets")
    byok_local_master_key: SecretStr | None = None
    billing_byok_enabled: bool = False
    billing_managed_ai_enabled: bool = False
    billing_compute_enabled: bool = False
    billing_max_ai_calls_per_minute: int = Field(default=60, ge=1, le=10_000)
    billing_max_compute_submissions_per_minute: int = Field(default=30, ge=1, le=10_000)
    billing_daily_ai_safety_minor_units: int = Field(default=0, ge=0)
    billing_daily_compute_safety_minor_units: int = Field(default=0, ge=0)
    billing_managed_ai_kill_switch: bool = False
    billing_compute_kill_switch: bool = False

    # ORCID iD (authenticate only, ADR-044). Off unless explicitly enabled; the client secret is a private
    # file (SSM -> /run/secrets), never an environment value.
    orcid_enabled: bool = False
    orcid_environment: Literal["sandbox", "production"] = "production"
    orcid_client_id: str | None = None
    orcid_client_secret: SecretStr | None = None
    orcid_client_secret_file: Path | None = None
    orcid_redirect_uri: str | None = None

    def effective_crest_lock_path(self) -> Path:
        """The CREST claim lock. An explicit `CHEMDFT_CREST_LOCK_PATH` wins. Otherwise a hosted backend (absolute
        object root, e.g. /data/objects) keeps it under the writable object directory, because the cwd-relative
        default is not writable there; local development keeps ./.chemdft/locks/crest.lock."""
        if "crest_lock_path" in self.model_fields_set:
            return self.crest_lock_path
        if Path(self.object_root).is_absolute():
            return Path(self.object_root) / "locks" / "crest.lock"
        return self.crest_lock_path

    @model_validator(mode="after")
    def _load_api_key_from_file(self) -> "Settings":
        # Allow the AI API key to be supplied via a private file (path in ai_api_key_file)
        # instead of an environment variable or process argument, so the secret never
        # appears in a child process environment or command line. The explicit
        # ai_api_key wins if both are present. A configured file that is missing or
        # unsafe fails closed; no fallback credential or provider is substituted.
        if self.ai_api_key is None and self.ai_api_key_file is not None:
            self.ai_api_key = SecretStr(read_secret_file(Path(self.ai_api_key_file)))
        if self.moonshot_api_key is None and self.moonshot_api_key_file is not None:
            self.moonshot_api_key = SecretStr(read_secret_file(Path(self.moonshot_api_key_file)))
        if self.orcid_environment == "production" and self.orcid_client_secret is not None:
            # Production credentials are only ever read from the private secret file, never from env text.
            raise ValueError(
                "CHEMDFT_ORCID_CLIENT_SECRET is refused for production; use CHEMDFT_ORCID_CLIENT_SECRET_FILE."
            )
        if self.orcid_client_secret is None and self.orcid_client_secret_file is not None:
            self.orcid_client_secret = SecretStr(
                read_secret_file(Path(self.orcid_client_secret_file))
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
