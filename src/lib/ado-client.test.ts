import { describe, expect, it } from "vitest";
import { AdoClient, AdoError, adoConfigFromEnv } from "./ado-client";

const cfg = { org: "my org", pat: "secret", baseUrl: "https://ado.test" };

function client(handler: (url: string, init: RequestInit) => { status?: number; body?: unknown; text?: string }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    const text = r.text ?? JSON.stringify(r.body ?? {});
    return new Response(text, { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { api: new AdoClient(cfg, fetchFn), calls };
}

describe("AdoClient", () => {
  it("reads the connection from the environment", () => {
    expect(adoConfigFromEnv({})).toBeNull();
    expect(adoConfigFromEnv({ ADO_ORG: "act-eg" })).toBeNull();
    expect(adoConfigFromEnv({ ADO_ORG: " act-eg ", ADO_PAT: "x" })).toEqual({ org: "act-eg", pat: "x", baseUrl: "https://dev.azure.com" });
  });

  it("signs requests with the token and lists projects", async () => {
    const { api, calls } = client(() => ({ body: { value: [{ name: "B" }, { name: "A" }] } }));
    expect(await api.listProjects()).toEqual(["A", "B"]);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from(":secret").toString("base64")}`);
    expect(calls[0].url).toContain("/my%20org/_apis/projects");
  });

  it("flattens iterations below the root", async () => {
    const { api } = client(() => ({
      body: { name: "P", children: [{ name: "Release 6", children: [{ name: "Sprint 62", attributes: { startDate: "2026-11-01T00:00:00Z", finishDate: "2026-12-10T00:00:00Z" } }] }] },
    }));
    const its = await api.listIterations("P");
    expect(its.map((i) => i.path)).toEqual(["P\\Release 6", "P\\Release 6\\Sprint 62"]);
    expect(its[1].startDate).toBe("2026-11-01T00:00:00Z");
  });

  it("fetches work items in batches of 200", async () => {
    const { api, calls } = client((_u, init) => {
      const ids = (JSON.parse(String(init.body)) as { ids: number[] }).ids;
      return { body: { value: ids.map((id) => ({ id, rev: 1, fields: {} })) } };
    });
    const items = await api.getWorkItems(Array.from({ length: 450 }, (_, i) => i + 1));
    expect(items).toHaveLength(450);
    expect(calls).toHaveLength(3);
  });

  it("explains common failures in plain words", async () => {
    await expect(client(() => ({ status: 401 })).api.listProjects()).rejects.toThrow(/access token/);
    await expect(client(() => ({ status: 403 })).api.listProjects()).rejects.toThrow(/permission/);
    await expect(client(() => ({ status: 429 })).api.listProjects()).rejects.toThrow(/slow down/);
    await expect(client(() => ({ text: "<html>sign in</html>" })).api.listProjects()).rejects.toThrow(/sign-in page/);
    const failing = new AdoClient(cfg, (async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    await expect(failing.listProjects()).rejects.toThrow(AdoError);
  });

  it("checks the revision before changing an item and reports a concurrent change", async () => {
    const ok = client(() => ({ body: { rev: 8 } }));
    expect(await ok.api.updateWorkItem(5, 7, [{ op: "add", path: "/fields/System.State", value: "Done" }])).toEqual({ ok: true, rev: 8 });
    const sent = JSON.parse(String(ok.calls[0].init.body));
    expect(sent[0]).toEqual({ op: "test", path: "/rev", value: 7 });
    expect(ok.calls[0].init.method).toBe("PATCH");

    const changed = client(() => ({ status: 412, text: "{}" }));
    expect(await changed.api.updateWorkItem(5, 7, [])).toEqual({ ok: false, reason: "changed" });
    const changed400 = client(() => ({ status: 400, text: JSON.stringify({ message: "TF26071: This work item has been changed by someone else" }) }));
    expect(await changed400.api.updateWorkItem(5, 7, [])).toEqual({ ok: false, reason: "changed" });
    const bad = client(() => ({ status: 400, text: JSON.stringify({ message: "The field is invalid" }) }));
    await expect(bad.api.updateWorkItem(5, 7, [])).rejects.toThrow("The field is invalid");
  });
});
