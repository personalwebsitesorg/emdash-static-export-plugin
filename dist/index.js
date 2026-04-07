import { definePlugin } from "emdash";
import { AwsClient } from "aws4fetch";
// @ts-ignore - generateSnapshot is an internal API as per instructions
import { generateSnapshot } from "emdash/dist/api/handlers/snapshot.mjs";
import { getDb } from "emdash/runtime";
export function createPlugin(options) {
    return definePlugin({
        id: "emdash-static-export",
        version: "1.0.0",
        // Request minimal capabilities
        capabilities: ["read:content", "network:fetch"],
        hooks: {
            "content:afterSave": {
                handler: async (event, ctx) => {
                    ctx.log.info("Starting non-blocking static export to R2...");
                    // Execute in the background so it doesn't block the editor
                    exportToR2AndTriggerBuild(options, ctx).catch((err) => {
                        ctx.log.error("Static export failed", err);
                    });
                }
            }
        }
    });
}
export default createPlugin;
async function exportToR2AndTriggerBuild(options, ctx) {
    try {
        // 1. Generate Snapshot
        // We pass a dummy origin so generateSnapshot injects the local API path
        const fakeOrigin = "http://internal-replace";
        const db = await getDb();
        // @ts-ignore - explicitly passing kysely DB
        const snapshot = await generateSnapshot(db, { origin: fakeOrigin });
        // 2. Transform URLs
        let json = JSON.stringify(snapshot);
        const mediaUrlRoot = options.mediaUrl.endsWith('/') ? options.mediaUrl : options.mediaUrl + '/';
        // Replace the internal URLs with the configured R2 public URL
        json = json.replaceAll(`${fakeOrigin}/_emdash/api/media/file/`, mediaUrlRoot);
        // 3. Upload to R2 using aws4fetch
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
            headers: {
                "Content-Type": "application/json",
            },
            body: json,
        });
        if (!uploadRes.ok) {
            throw new Error(`Failed to upload to R2: HTTP ${uploadRes.status} ${await uploadRes.text()}`);
        }
        ctx.log.info(`[emdash-static-export] Uploaded snapshot to R2 bucket: ${options.r2BucketName}/${key}`);
        // 4. Trigger Webhook
        if (options.deployHookUrl && ctx.http) {
            ctx.log.info(`[emdash-static-export] Triggering deployment webhook...`);
            const res = await ctx.http.fetch(options.deployHookUrl, { method: "POST" });
            if (!res.ok) {
                ctx.log.warn(`[emdash-static-export] Webhook failed with status ${res.status}`);
            }
            else {
                ctx.log.info(`[emdash-static-export] Webhook triggered successfully`);
            }
        }
    }
    catch (error) {
        ctx.log.error(`[emdash-static-export] Error during export background task: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}
