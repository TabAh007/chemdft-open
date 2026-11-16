"use client";

import { plural } from "@/lib/overview-model";
import { useEffect, useState } from "react";

import type { ComputeJobView } from "@chemdft/schemas";
import { AppIcon, StatusTag } from "@chemdft/ui";
import Link from "next/link";

import { listProjects, type ProjectRead } from "@/lib/project-api";
import { listComputeJobs } from "@/lib/structure-workspace-api";

type ProjectJob = {
  project: ProjectRead;
  job: ComputeJobView;
};

export function GlobalJobsClient({ locale }: { locale: string }) {
  const [rows, setRows] = useState<ProjectJob[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const projects = await listProjects();
        const jobGroups = await Promise.all(
          projects.map(async (project) => ({
            project,
            jobs: (await listComputeJobs(project.id)).jobs,
          })),
        );
        if (!active) return;
        setRows(
          jobGroups
            .flatMap((group) => group.jobs.map((job) => ({ project: group.project, job })))
            .sort((left, right) => right.job.updated_at.localeCompare(left.job.updated_at)),
        );
        setMessage(null);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Unable to load jobs.");
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <>
      <div className="projects-heading">
        <div>
          <h1>Jobs</h1>
          <p>Monitor authorized scientific compute across visible projects.</p>
        </div>
        <StatusTag>{plural(rows.length, "job")}</StatusTag>
      </div>
      {message ? (
        <div className="foundation-strip">
          <AppIcon icon="warning-sign" /> {message}
        </div>
      ) : null}
      <table className="jobs-table">
        <thead>
          <tr>
            <th scope="col">Project</th>
            <th scope="col">Job</th>
            <th scope="col">Provider</th>
            <th scope="col">Compute</th>
            <th scope="col">Scientific</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6}>No compute jobs yet. No synthetic progress is shown.</td>
            </tr>
          ) : (
            rows.map(({ project, job }) => (
              <tr key={`${project.id}:${job.id}`}>
                <td>
                  <Link href={`/${locale}/projects/${project.id}/jobs`}>{project.name}</Link>
                </td>
                <td>{job.id.slice(0, 8)}</td>
                <td>{job.provider}</td>
                <td>{job.state}</td>
                <td>{job.latest_execution?.state ?? "QUEUED"}</td>
                <td>{new Date(job.updated_at).toLocaleString()}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
