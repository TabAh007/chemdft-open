from dataclasses import dataclass, replace


@dataclass(frozen=True)
class Identity:
    """The authenticated actor of a request: a person acting inside one organization."""

    user_id: str
    organization_id: str

    @property
    def principal_type(self) -> str:
        return "user"


@dataclass(frozen=True)
class ServiceIdentity(Identity):
    """A background process or webhook receiver acting for the platform, never a person.

    `user_id` is the id of a reserved service row (see `service_principals.py`), so the foreign
    keys of records the service writes stay valid while remaining distinguishable from humans.

    A service has no standing access to any project. Its access is bound to one claimed work item
    (`work_id`, of the kind its capability allows) in one project (`work_project_id`).
    `organization_id` is attribution for the rows it writes, not an authorization input.
    """

    service: str = ""
    work_id: str | None = None
    work_project_id: str | None = None

    @property
    def principal_type(self) -> str:
        return "service"

    def for_work(
        self, work_id: str, work_project_id: str, organization_id: str
    ) -> "ServiceIdentity":
        return replace(
            self,
            work_id=work_id,
            work_project_id=work_project_id,
            organization_id=organization_id,
        )
