import { PGlite } from "@electric-sql/pglite";
import { AIMessage } from "@langchain/core/messages";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClaudeMarketingModel } from "@/lib/marketing/generation";
import { parseSourcePacket, type MarketingRevisionRow, type PublicationRow } from "@/lib/marketing/contracts";
import { revisionHash } from "@/lib/marketing/hashes";
import { currentMarketingTemplate, renderMarketingPreview, type MarketingAssetStorage, type MarketingTemplate } from "@/lib/marketing/render";
import { ingestSource, saveRevision } from "@/lib/marketing/store";
import { publishMarketingRevision, type MarketingPublishAccount, type PublisherCheckpoint, type PublisherState } from "@/lib/marketing/publisher";
import { runMarketingWorkerJob, type MarketingWorkerRequest } from "../../services/marketing-worker/protocol";
import type { createAdminClient } from "@/lib/supabase/admin";
import heldQuestion from "../../templates/marketing/benchmarks/devshark-question.json";
import design from "../../templates/marketing/devshark/derived-layout.json";

vi.mock("server-only", () => ({}));
const sdk = vi.hoisted(() => ({ invoke: vi.fn(), constructor: vi.fn(), structured: vi.fn() }));
vi.mock("@langchain/anthropic", () => ({
  ChatAnthropic: class {
    constructor(options: unknown) { sdk.constructor(options); }
    withStructuredOutput(schema: unknown, options: unknown) {
      sdk.structured(schema, options);
      return { invoke: sdk.invoke };
    }
  },
}));

const owner = "11111111-1111-4111-8111-111111111111";
const revisionId = "33333333-3333-4333-8333-333333333333";
const accountId = "44444444-4444-4444-8444-444444444444";
const unpublishedId = "55555555-5555-4555-8555-555555555555";
let database: PGlite;
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Only adapts the Supabase RPC transport. The migrations/functions execute unchanged in Postgres. */
function rpcDatabase() {
  const signatures: Record<string, string[]> = {
    marketing_ingest_source: ["p_owner", "p_packet"],
    marketing_save_revision: ["p_owner", "p_id", "p_revision", "p_hash", "p_ready", "p_slides", "p_replace"],
  };
  return { rpc: async (name: string, values: Record<string, unknown>) => {
    const parameters = signatures[name];
    if (!parameters) throw new Error("unexpected-test-rpc");
    try {
      const args = parameters.map((key) => values[key] && typeof values[key] === "object" ? JSON.stringify(values[key]) : values[key]);
      const response = await database.query<{ value: string }>(`select ${name}(${parameters.map((_, index) => `$${index + 1}`).join(",")}) as value`, args);
      return { data: response.rows[0].value, error: null };
    } catch (error) { return { data: null, error }; }
  } } as unknown as ReturnType<typeof createAdminClient>;
}

beforeAll(async () => {
  database = new PGlite();
  await database.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.projects(id uuid primary key,user_id uuid not null);
    create table public.ai_links(id uuid primary key,user_id uuid not null);`);
  await database.query("insert into auth.users values($1)", [owner]);
  for (const filename of ["20261012225640_marketing_control_surface.sql", "20261012232949_marketing_durable_jobs.sql"]) {
    await database.exec(readFileSync(`supabase/migrations/${filename}`, "utf8"));
  }
}, 30000);
afterAll(async () => { await database?.close(); vi.unstubAllGlobals(); });

describe("OFFLINE SIMULATION: authored source → actual JPEG → exact owner approval → mocked Meta receipt", () => {
  it("publishes the exact preview bytes once using real SQL fences, with no Meta requests before owner approval", async () => {
    // A missed injection fails the test instead of making any real provider/storage/Meta HTTP request.
    const forbiddenNetwork = vi.fn(async () => { throw new Error("real-network-forbidden-in-offline-pipeline"); });
    vi.stubGlobal("fetch", forbiddenNetwork);
    expect(heldQuestion.eligible).toBe(false);
    const repositoryTemplate = currentMarketingTemplate("devshark");
    expect(repositoryTemplate.approved).toBe(false);
    const source = parseSourcePacket({ ...structuredClone(heldQuestion), eligible: true,
      eligibilityReason: "OFFLINE TEST SIMULATION ONLY: producer unavailable; original fixture remains held",
      observedAt: new Date().toISOString() });
    const template: MarketingTemplate = { ...repositoryTemplate, approved: true,
      approval: { approvedBy: owner, approvedAt: new Date().toISOString(), templateSha256: repositoryTemplate.templateSha256, designExportSha256: design.archiveSha256 } };
    const db = rpcDatabase();
    const copy = { title: source.content.title, caption: "Choose an answer, then review the authored explanation.", locale: "en", slides: [
      { headline: "Choose an answer", body: "Read the authored question.", code: null, evidenceIndexes: [] },
      { headline: "Review", body: "Read the authored explanation.", code: null, evidenceIndexes: [] },
    ] };
    sdk.invoke.mockResolvedValue({ parsed: copy, raw: new AIMessage({ content: "", usage_metadata: { input_tokens: 200, output_tokens: 100, total_tokens: 300 } }) });
    const model = await createClaudeMarketingModel({ apiKey: "TEST-ONLY-NO-PROVIDER-CREDENTIAL", model: "claude-offline-pipeline-test",
      pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } }); // Synthetic arithmetic inputs; no actual provider cost.
    const uploaded = new Map<string, { bytes: Buffer; sha256: string; metadata: Record<string, string> }>();
    const put: MarketingAssetStorage["put"] = vi.fn(async (input) => {
      expect(sha(input.bytes)).toBe(input.sha256);
      expect(input.metadata.designExportSha256).toBe(design.archiveSha256);
      const url = `https://assets.example.invalid/${owner}/${input.key}`;
      const previous = uploaded.get(url);
      if (previous) {
        expect(previous.sha256).toBe(input.sha256);
        expect(previous.bytes.equals(input.bytes)).toBe(true);
        expect(previous.metadata).toEqual(input.metadata);
      } else uploaded.set(url, { bytes: Buffer.from(input.bytes), sha256: input.sha256, metadata: { ...input.metadata } });
      return { url, sha256: input.sha256 };
    });
    const request: MarketingWorkerRequest = { schemaVersion: "marketing-job/1", idempotencyKey: revisionId, template,
      generation: { source, revisionId, consent: true, templateVersion: template.version, knowledge: [],
        account: { id: "101", platform: "instagram", handle: "offline_qa_only" }, scheduledAt: new Date(Date.now() + 3600000).toISOString() } };
    const reloadSource = vi.fn(async () => {
      source.observedAt = new Date().toISOString();
      await ingestSource(db, owner, source, source.brand);
      return source;
    });
    const generated = await runMarketingWorkerJob(request, { model, storage: { put }, reloadSource,
      reloadTemplate: async () => template });
    expect(reloadSource).toHaveBeenCalledTimes(2);
    expect(sdk.invoke).toHaveBeenCalledTimes(1);
    expect(sdk.constructor).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-offline-pipeline-test", maxRetries: 0 }));
    expect(sdk.structured).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ strict: true, includeRaw: true }));
    expect(generated.slides[1].code).toBe(heldQuestion.content.code);
    expect(generated.slides[3].body).toContain(heldQuestion.content.explanation);
    expect(generated.revision.assets).toHaveLength(4);
    expect(uploaded.size).toBe(4);
    await database.query(`insert into marketing_accounts(id,user_id,brand,platform,remote_account_id,handle,verified_at,enabled)
      values($1,$2,'devshark','instagram','101','offline_qa_only',now(),true)`, [accountId, owner]);
    // PostgreSQL now() is stable during a transaction. Anchor approval's future
    // schedule to that same clock so CPU contention cannot expire this fixture
    // between saving it and exercising the real owner approval functions.
    await database.exec("begin");
    const approvalSchedule = (await database.query<{ scheduled_at: Date }>("select now() + interval '300 milliseconds' as scheduled_at")).rows[0].scheduled_at;
    const revision = { ...generated.revision, scheduledAt: approvalSchedule.toISOString() };
    const hash = revisionHash(revision);
    expect(await saveRevision(db, owner, revision, { id: revisionId, slides: generated.slides })).toEqual({ id: revisionId, ready: true });
    const loadState = async (): Promise<PublisherState> => {
      const row = (await database.query<MarketingRevisionRow>("select * from marketing_revisions where id=$1", [revisionId])).rows[0];
      const account = (await database.query<MarketingPublishAccount>("select * from marketing_accounts where id=$1", [accountId])).rows[0];
      const packets = await database.query<{ packet: unknown }>("select packet from marketing_sources where user_id=$1 and brand='devshark'", [owner]);
      return { revisionRow: row, account, sources: packets.rows.map((entry) => parseSourcePacket(entry.packet)) };
    };
    const calls: Array<{ method: string; url: URL; fields: URLSearchParams }> = [];
    let nextContainer = 200;
    const fetcher: typeof fetch = async (input, options) => {
      const url = new URL(String(input)); const method = options?.method ?? "GET";
      const fields = new URLSearchParams(String(options?.body ?? ""));
      calls.push({ method, url, fields });
      if (url.hostname === "assets.example.invalid") {
        const asset = uploaded.get(url.href); expect(asset).toBeDefined();
        return new Response(new Uint8Array(asset!.bytes), { headers: { "Content-Type": "image/jpeg", "Content-Length": String(asset!.bytes.length) } });
      }
      expect(url.hostname).toBe("graph.instagram.com");
      if (url.pathname.endsWith("/content_publishing_limit")) return Response.json({ data: [{ quota_usage: 0, config: { quota_total: 100 } }] });
      if (url.pathname.endsWith("/media_publish") && method === "POST") {
        const intent = (await database.query<{ error_code: string; remote_container_id: string }>("select error_code,remote_container_id from marketing_publications where revision_id=$1", [revisionId])).rows[0];
        expect(intent).toEqual({ error_code: "publish-intent", remote_container_id: "205" });
        return Response.json({ id: "301" });
      }
      if (url.pathname.endsWith("/media") && method === "POST") {
        // Containers are unpublished drafts: they are created under the live claim, before any publish intent (approval-04).
        const checkpoint = (await database.query<{ status: string; error_code: string | null }>("select status,error_code from marketing_publications where revision_id=$1", [revisionId])).rows[0];
        expect(checkpoint.status).toBe("claimed"); expect(checkpoint.error_code).not.toBe("publish-intent");
        return Response.json({ id: String(++nextContainer) });
      }
      if (url.pathname.endsWith("/101")) return Response.json({ id: "101", username: "offline_qa_only" });
      if (url.pathname.endsWith("/301")) return Response.json({ id: "301", permalink: "https://www.instagram.com/p/offline-simulation-only/" });
      if (/\/20[1-5]$/.test(url.pathname)) return Response.json({ id: url.pathname.split("/").at(-1), status_code: "FINISHED" });
      throw new Error("unexpected-offline-meta-request");
    };
    const config = { enabled: true, apiVersion: "v99.0", apiVersionVerifiedAt: new Date().toISOString(), loginMode: "instagram" as const,
      accessToken: "TEST-ONLY-NO-META-CREDENTIAL", tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      scopes: ["instagram_business_basic", "instagram_business_content_publish"], approvedAssetHosts: ["assets.example.invalid"], pollIntervalMs: 0 };
    expect((await database.query("select * from marketing_claim_due($1,1,'devshark')", [owner])).rows).toEqual([]);
    const beforeApproval = await publishMarketingRevision({ ...await loadState(), config, dryRun: false, fetcher,
      publication: { id: unpublishedId, user_id: owner, revision_id: revisionId, platform: "instagram", status: "claimed", lease_until: new Date(Date.now() + 600000).toISOString(),
        remote_container_id: null, remote_media_id: null, remote_url: null, error_code: null },
      checkpoint: async () => { throw new Error("checkpoint-must-not-run-before-approval"); }, revalidate: loadState });
    expect(beforeApproval).toMatchObject({ status: "held", errorCode: "exact-approval-required" });
    expect(calls).toEqual([]);
    await database.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await database.exec("set role authenticated");
    const first = await database.query<{ id: string }>("select marketing_approve_revision($1,$2) id", [revisionId, hash]);
    const duplicate = await database.query<{ id: string }>("select marketing_approve_revision($1,$2) id", [revisionId, hash]);
    await database.exec("reset role");
    expect((await database.query("select * from marketing_claim_due($1,1,'devshark')", [owner])).rows).toEqual([]);
    await database.exec("commit");
    expect(duplicate.rows[0].id).toBe(first.rows[0].id);
    expect((await database.query<{ count: number }>("select count(*)::int as count from marketing_publications")).rows[0].count).toBe(1);
    expect((await database.query<{ count: number }>("select count(*)::int as count from marketing_events where kind='approved'")).rows[0].count).toBe(1);
    const preview = await renderMarketingPreview({ draft: { revision, slides: generated.slides }, template, revisionId });
    for (const [index, image] of preview.entries()) {
      const approvedAsset = revision.assets[index];
      expect(sha(image.jpeg)).toBe(approvedAsset.sha256);
      expect(uploaded.get(approvedAsset.url)!.bytes.equals(image.jpeg)).toBe(true);
    }
    // Wait for the unchanged approved schedule to become due on the real SQL
    // clock; neither the revision/hash nor the publication time is rewritten.
    await expect.poll(async () => (await database.query<{ due: boolean }>("select scheduled_at<=now() as due from marketing_publications where revision_id=$1", [revisionId])).rows[0].due,
      { timeout: 10000, interval: 50 }).toBe(true);
    await reloadSource(); // Explicit simulated producer refresh is persisted before the due claim.
    expect((await database.query("select * from marketing_claim_due($1,1,'dneskai')", [owner])).rows).toEqual([]);
    const claimed = await database.query<PublicationRow & { user_id: string; lease_until: string }>("select * from marketing_claim_due($1,1,'devshark')", [owner]);
    expect(claimed.rows).toHaveLength(1);
    expect((await database.query("select * from marketing_claim_due($1,1,'devshark')", [owner])).rows).toEqual([]);
    const publication = claimed.rows[0];
    let container = publication.remote_container_id; let error = publication.error_code;
    const checkpoint = async (value: PublisherCheckpoint) => {
      if (value.stage === "outcome") await database.query("select marketing_finish_publication($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [owner, publication.id, container, error, value.status, value.remoteContainerId, value.remoteMediaId, value.remoteUrl, value.errorCode]);
      else await database.query("select marketing_checkpoint_publication($1,$2,$3,$4,$5,$6)",
        [owner, publication.id, container, error, value.remoteContainerId, value.errorCode]);
      container = value.remoteContainerId; error = value.errorCode;
    };
    const outcome = await publishMarketingRevision({ ...await loadState(), publication, config, dryRun: false, fetcher, checkpoint,
      revalidate: async () => { await reloadSource(); return loadState(); } });
    expect(outcome).toEqual({ status: "published", errorCode: null, remoteContainerId: "205", remoteMediaId: "301", remoteUrl: "https://www.instagram.com/p/offline-simulation-only/" });
    const posts = calls.filter((entry) => entry.method === "POST");
    expect(posts).toHaveLength(6);
    expect(posts.filter((entry) => entry.url.pathname.endsWith("/media_publish"))).toHaveLength(1);
    expect(posts.filter((entry) => entry.fields.get("is_carousel_item") === "true").map((entry) => entry.fields.get("image_url"))).toEqual(revision.assets.map((asset) => asset.url));
    const finished = await loadState();
    expect(finished.revisionRow).toMatchObject({ status: "published", ready: true, content_hash: hash, approved_hash: hash });
    expect(revisionHash(finished.revisionRow.revision)).toBe(hash);
    expect((await database.query<{ status: string; remote_media_id: string; remote_url: string }>("select status,remote_media_id,remote_url from marketing_publications")).rows).toEqual([{ status: "published", remote_media_id: "301", remote_url: outcome.remoteUrl }]);
    expect((await database.query<{ count: number }>("select count(*)::int as count from marketing_events where kind='published'")).rows[0].count).toBe(1);
    expect(heldQuestion.eligible).toBe(false);
    expect(currentMarketingTemplate("devshark").approved).toBe(false);
    expect(forbiddenNetwork).not.toHaveBeenCalled();
  }, 60000);
});
