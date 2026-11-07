// Sends one item's changes to Azure DevOps. Kept apart from the database code so it is easy to test.
import { AdoError, type AdoClient } from "./ado-client";
import type { ItemSnapshot, PlannedAdoUpdate } from "./ado-sync";

/** Sends one item's changes. If Azure DevOps refuses the whole change, each field is tried alone. */
export async function pushOne(api: AdoClient, u: PlannedAdoUpdate, current: ItemSnapshot | undefined): Promise<{ snapshot?: ItemSnapshot; errors: string[] }> {
  const errors: string[] = [];
  let snapshot: ItemSnapshot | undefined = current;
  let rev = u.rev;
  const apply = (patch: Partial<ItemSnapshot>, newRev: number) => {
    snapshot = { ...(snapshot ?? { rev: newRev, status: null, assignee: null, sprint: null, hours: null }), ...patch, rev: newRev };
    rev = newRev;
  };
  const attempt = async (ops: PlannedAdoUpdate["fields"]): Promise<"ok" | "changed" | string> => {
    try {
      const res = await api.updateWorkItem(u.adoId, rev, ops.flatMap((f) => f.ops));
      if (!res.ok) return "changed";
      apply(Object.assign({}, ...ops.map((f) => f.snapshot)), res.rev);
      return "ok";
    } catch (err) {
      return err instanceof AdoError ? err.message : "unexpected error";
    }
  };

  const all = await attempt(u.fields);
  if (all === "ok") return { snapshot, errors };
  if (all === "changed") {
    errors.push(`${u.label} was changed in Azure DevOps while syncing. It will be checked again next time.`);
    return { errors };
  }
  if (u.fields.length === 1) {
    errors.push(`${u.label}: ${all}`);
    return { errors };
  }
  for (const f of u.fields) {
    const one = await attempt([f]);
    if (one === "changed") errors.push(`${u.label} was changed in Azure DevOps while syncing. It will be checked again next time.`);
    else if (one !== "ok") errors.push(`${u.label} (${f.key}): ${one}`);
  }
  return { snapshot: snapshot === current ? undefined : snapshot, errors };
}
