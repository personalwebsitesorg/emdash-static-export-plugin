import { definePlugin } from "emdash";
import { AwsClient } from "aws4fetch";
// These imports resolve through Vite at runtime (the built dist uses
// hashed chunk names, so direct file paths don't work — Vite maps the
// package.json "exports" to the correct source/chunk).
// @ts-ignore — tsdown bundles emdash into flat chunks; TS can't resolve the subpath export
import { generateSnapshot } from "emdash/api/handlers/snapshot";
import { getDb } from "emdash/runtime";
export function createPlugin(options) {
    return definePlugin({
        id: "emdash-static-export",
        version: "1.0.0",
        capabilities: ["read:content", "network:fetch:any"],
        hooks: {
            "content:afterSave": {
                // Snapshot + R2 upload can be slow — give it plenty of time
                timeout: 60_000,
                // Never fail the content save because the export broke
                errorPolicy: "continue",
                handler: async (_event, ctx) => {
                    ctx.log.info("Starting static export to R2...");
                    // CRITICAL: await the export — do NOT fire-and-forget.
                    //
                    // getDb() reads the DB instance from AsyncLocalStorage (request
                    // context). If we detach the promise chain (.catch without await),
                    // the request may complete before getDb() runs, leaving the ALS
                    // store empty and causing a silent failure or hang.
                    //
                    // With errorPolicy:"continue" + high timeout, even though we await,
                    // the content save still succeeds regardless of export outcome.
                    try {
                        await exportToR2AndTriggerBuild(options, ctx);
                    }
                    catch (err) {
                        // errorPolicy:"continue" means the hook pipeline already handles
                        // this, but log explicitly so it's impossible to miss.
                        ctx.log.error("Export failed: " +
                            (err instanceof Error ? err.stack || err.message : String(err)));
                    }
                },
            },
        },
    });
}
export default createPlugin;
// ─── Background export logic ───────────────────────────────────────
async function exportToR2AndTriggerBuild(options, ctx) {
    // 1. Obtain DB handle (from ALS request context → cached singleton)
    ctx.log.info("[1/4] Acquiring database connection...");
    const db = await getDb();
    // 2. Generate portable snapshot
    const siteUrl = ctx.site.url || "http://localhost:4321";
    ctx.log.info(`[2/4] Generating snapshot (origin: ${siteUrl})...`);
    const snapshot = await generateSnapshot(db, { origin: siteUrl });
    // 3. Transform media URLs:
    //    snapshot has URLs like  {siteUrl}/_emdash/api/media/file/{storageKey}
    //    replace with the R2 public URL the static site will use.
    let json = JSON.stringify(snapshot);
    const mediaUrlRoot = options.mediaUrl.endsWith("/")
        ? options.mediaUrl
        : options.mediaUrl + "/";
    json = json.replaceAll(`${siteUrl}/_emdash/api/media/file/`, mediaUrlRoot);
    ctx.log.info(`[3/4] Snapshot ready (${(json.length / 1024).toFixed(1)} KB). Uploading to R2...`);
    // 4. Upload to R2 via S3-compatible API
    const aws = new AwsClient({
        accessKeyId: options.r2AccessKeyId,
        secretAccessKey: options.r2SecretAccessKey,
        region: "auto",
        service: "s3",
    });
    const key = "exports/site-export.json";
    const endpoint = `https://${options.r2AccountId}.r2.cloudflarestorage.com/${options.r2BucketName}/${key}`;
    const uploadRes = await aws.fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: json,
    });
    if (!uploadRes.ok) {
        const body = await uploadRes.text().catch(() => "(unreadable)");
        throw new Error(`R2 upload failed: HTTP ${uploadRes.status} — ${body}`);
    }
    ctx.log.info(`[3/4] Uploaded to ${options.r2BucketName}/${key}`);
    // 5. Trigger deployment webhook
    if (options.deployHookUrl) {
        ctx.log.info("[4/4] Triggering deployment webhook...");
        const res = await fetch(options.deployHookUrl, { method: "POST" });
        if (!res.ok) {
            ctx.log.warn(`Webhook returned HTTP ${res.status}`);
        }
        else {
            ctx.log.info("[4/4] Webhook triggered ✓");
        }
    }
    else {
        ctx.log.info("[4/4] No webhook configured — skipping.");
    }
}
