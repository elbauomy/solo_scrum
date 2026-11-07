// Small client for the Azure DevOps REST API. Only what the sync needs.
// The token (ADO_PAT) is read from the environment and never leaves the server.
import type { WorkItemType } from "@prisma/client";

export class AdoError extends Error {}

export type AdoConfig = { org: string; pat: string; baseUrl: string };

/** Reads ADO_ORG, ADO_PAT and (for tests only) ADO_BASE_URL. Returns null when the connection is not set up. */
export function adoConfigFromEnv(env: Record<string, string | undefined>): AdoConfig | null {
  const org = (env.ADO_ORG ?? "").trim();
  const pat = (env.ADO_PAT ?? "").trim();
  if (!org || !pat) return null;
  return { org, pat, baseUrl: (env.ADO_BASE_URL ?? "https://dev.azure.com").replace(/\/+$/, "") };
}

/** The work item types we bring in, and what they are called in Azure DevOps (Scrum process). */
export const ADO_TYPE_TO_LOCAL: Record<string, WorkItemType> = {
  Epic: "EPIC",
  Feature: "FEATURE",
  "Product Backlog Item": "STORY",
  "User Story": "STORY",
  Bug: "BUG",
  Task: "TASK",
};

/** Raw work item as returned by the API (only the fields we use). */
export type RawWorkItem = {
  id: number;
  rev: number;
  fields: Record<string, unknown>;
  relations?: { rel: string; url: string }[];
};

export type RawIteration = { path: string; name: string; startDate: string | null; finishDate: string | null };

export type PatchOp = { op: "add" | "replace" | "test" | "remove"; path: string; value?: unknown };

const FIELDS = [
  "System.Id", "System.Rev", "System.WorkItemType", "System.State", "System.Title", "System.Description", "System.AssignedTo",
  "System.IterationPath", "System.ChangedDate", "System.CreatedDate", "System.Parent", "Microsoft.VSTS.Common.AcceptanceCriteria",
  "Microsoft.VSTS.Common.Priority", "Microsoft.VSTS.Common.BacklogPriority", "Microsoft.VSTS.Common.StateChangeDate",
  "Microsoft.VSTS.Common.ClosedDate", "Microsoft.VSTS.Scheduling.RemainingWork", "Microsoft.VSTS.Scheduling.OriginalEstimate",
];

export class AdoClient {
  constructor(private cfg: AdoConfig, private fetchFn: typeof fetch = fetch) {}

  private async call(url: string, init: RequestInit = {}): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`:${this.cfg.pat}`).toString("base64")}`,
      Accept: "application/json",
      ...((init.headers as Record<string, string>) ?? {}),
    };
    let res: Response;
    try {
      res = await this.fetchFn(url, { ...init, headers, cache: "no-store" });
    } catch {
      throw new AdoError("Could not reach Azure DevOps. Check the internet connection and try again.");
    }
    if (res.status === 401 || res.status === 203) throw new AdoError("Azure DevOps refused the access token. It may have expired: create a new one and update ADO_PAT.");
    if (res.status === 403) throw new AdoError("The access token does not have permission for this. It needs Work Items (Read & write).");
    if (res.status === 404) throw new AdoError("Azure DevOps could not find that project or item.");
    if (res.status === 409 || res.status === 412) throw new AdoError("PRECONDITION");
    if (res.status === 429) throw new AdoError("Azure DevOps asked us to slow down (too many requests). Please try again in a minute.");
    const text = await res.text();
    // A failed "test /rev" check means somebody changed the item after we read it.
    if (res.status === 400 && /TF26071|\/rev|has been changed|has been updated/i.test(text)) throw new AdoError("PRECONDITION");
    if (!res.ok) {
      let message = text.slice(0, 200);
      try {
        message = (JSON.parse(text.replace(/^﻿/, "")) as { message?: string }).message ?? message;
      } catch {
        /* keep raw text */
      }
      throw new AdoError(`Azure DevOps said: ${message}`);
    }
    if (text.trimStart().startsWith("<")) throw new AdoError("Azure DevOps sent a sign-in page instead of data. The access token is probably wrong or expired.");
    return text ? JSON.parse(text.replace(/^﻿/, "")) : {};
  }

  private url(project: string | null, path: string): string {
    const base = `${this.cfg.baseUrl}/${encodeURIComponent(this.cfg.org)}`;
    return `${base}/${project ? `${encodeURIComponent(project)}/` : ""}_apis/${path}`;
  }

  async listProjects(): Promise<string[]> {
    const names: string[] = [];
    let skip = 0;
    for (;;) {
      const page = (await this.call(this.url(null, `projects?$top=100&$skip=${skip}&api-version=7.1`))) as { value?: { name: string }[] };
      const value = page.value ?? [];
      names.push(...value.map((p) => p.name));
      if (value.length < 100) break;
      skip += 100;
    }
    return names.sort((a, b) => a.localeCompare(b));
  }

  /** All sprints (iterations) of a project, with their dates. */
  async listIterations(project: string): Promise<RawIteration[]> {
    const root = (await this.call(this.url(project, "wit/classificationnodes/iterations?$depth=6&api-version=7.1"))) as AdoNode;
    const out: RawIteration[] = [];
    const walk = (n: AdoNode, parentPath: string) => {
      const path = parentPath ? `${parentPath}\\${n.name}` : n.name;
      if (parentPath) out.push({ path, name: n.name, startDate: n.attributes?.startDate ?? null, finishDate: n.attributes?.finishDate ?? null });
      for (const c of n.children ?? []) walk(c, path);
    };
    walk(root, "");
    return out;
  }

  /** Ids of every work item of the supported types in a project. */
  async listWorkItemIds(project: string): Promise<number[]> {
    const types = Object.keys(ADO_TYPE_TO_LOCAL).map((t) => `'${t}'`).join(", ");
    const query = `Select [System.Id] From WorkItems Where [System.TeamProject] = @project And [System.WorkItemType] In (${types}) Order By [System.Id]`;
    const res = (await this.call(this.url(project, "wit/wiql?api-version=7.1"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    })) as { workItems?: { id: number }[] };
    return (res.workItems ?? []).map((w) => w.id);
  }

  /** Fetches work items in batches of 200 with their relations. */
  async getWorkItems(ids: number[]): Promise<RawWorkItem[]> {
    const items: RawWorkItem[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const res = (await this.call(this.url(null, "wit/workitemsbatch?api-version=7.1"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: chunk, fields: FIELDS, errorPolicy: "Omit" }),
      })) as { value?: (RawWorkItem | null)[] };
      for (const w of res.value ?? []) if (w) items.push(w);
    }
    return items;
  }

  /**
   * Changes fields of one work item. The first operation checks that nobody changed the item since we read it;
   * returns false (and changes nothing) when somebody did.
   */
  async updateWorkItem(id: number, rev: number, ops: PatchOp[]): Promise<{ ok: true; rev: number } | { ok: false; reason: "changed" }> {
    try {
      const res = (await this.call(this.url(null, `wit/workitems/${id}?api-version=7.1`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json-patch+json" },
        body: JSON.stringify([{ op: "test", path: "/rev", value: rev }, ...ops]),
      })) as { rev: number };
      return { ok: true, rev: res.rev };
    } catch (err) {
      if (err instanceof AdoError && err.message === "PRECONDITION") return { ok: false, reason: "changed" };
      throw err;
    }
  }
}

type AdoNode = { name: string; attributes?: { startDate?: string; finishDate?: string }; children?: AdoNode[] };
