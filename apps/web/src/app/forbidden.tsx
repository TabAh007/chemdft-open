import { StatePage } from "./_components/state-page";

export default function Forbidden() {
  return <StatePage code="403" title="This project is outside your access boundary" description="ChemDFT denied the request before project files or metadata were returned. Ask a project owner to review your membership." icon="lock" actionHref="/en/projects" actionLabel="Return to projects" />;
}
