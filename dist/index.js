import { definePlugin } from "emdash";
import { AwsClient } from "aws4fetch";
import { getDb } from "emdash/runtime";
import { sql } from "kysely";
// --- Plugin Entry Point ---
export function createPlugin(options) {
    return definePlugin({
        id: "emdash-static-export",
        version: "1.0.0",
        capabilities: ["read:content", "network:fetch:any"],
        hooks: {
            "content:afterSave": {
                timeout: 60_000,
                errorPolicy: "continue",
                handler: async (_event, ctx) => {
                    ctx.log.info("Starting static export to R2...");
                    try {
                        await exportToR2AndTriggerBuild(options, ctx);
                        ctx.log.info("Static export completed successfully.");
                    }
                    catch (err) {
                        ctx.log.error("Export failed: " +
                            (err instanceof Error ? err.stack || err.message : String(err)));
                    }
                },
            },
        },
    });
}
export default createPlugin;
// --- Background export logic ---
async function exportToR2AndTriggerBuild(options, ctx) {
    // 1. Obtain DB handle
    ctx.log.info("[1/4] Acquiring database connection...");
    const db = await getDb(); // Cast to any to avoid complex Kysely types
    // 2. Generate portable snapshot (Local implementation to avoid dependency issues)
    const siteUrl = ctx.site.url || "http://localhost:4321";
    ctx.log.info(`[2/4] Generating snapshot...`);
    const snapshot = await generateSnapshotInternal(db, { origin: siteUrl });
    // 3. Transform media URLs
    let json = JSON.stringify(snapshot);
    const mediaUrlRoot = options.mediaUrl.endsWith("/")
        ? options.mediaUrl
        : options.mediaUrl + "/";
    json = json.replaceAll(`${siteUrl}/_emdash/api/media/file/`, mediaUrlRoot);
    ctx.log.info(`[3/4] Snapshot ready (${(json.length / 1024).toFixed(1)} KB). Uploading to R2...`);
    // 4. Upload to R2
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
}
// --- Internal Snapshot Implementation (copied from emdash core) ---
const SYSTEM_TABLES = [
    "_emdash_collections",
    "_emdash_fields",
    "_emdash_taxonomy_defs",
    "_emdash_menus",
    "_emdash_menu_items",
    "_emdash_sections",
    "_emdash_widget_areas",
    "_emdash_widgets",
    "_emdash_seo",
    "_emdash_migrations",
    "taxonomies",
    "content_taxonomies",
    "media",
    "options",
    "revisions",
];
const EXCLUDED_PREFIXES = [
    "_emdash_api_tokens",
    "_emdash_oauth_tokens",
    "_emdash_authorization_codes",
    "_emdash_device_codes",
    "_emdash_migrations_lock",
    "_plugin_",
    "users",
    "sessions",
    "credentials",
    "challenges",
];
const SAFE_OPTIONS_PREFIXES = ["site:"];
const SAFE_TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
async function generateSnapshotInternal(db, opts) {
    const tableResult = await sql `
    SELECT name FROM sqlite_master 
    WHERE type = 'table' AND name LIKE 'ec_%'
  `.execute(db);
    const allTables = [...tableResult.rows.map((r) => r.name), ...SYSTEM_TABLES];
    const tables = {};
    const schema = {};
    for (const tableName of allTables) {
        if (EXCLUDED_PREFIXES.some(p => tableName.startsWith(p)))
            continue;
        if (!SAFE_TABLE_NAME.test(tableName))
            continue;
        try {
            const pragmaResult = await sql `PRAGMA table_info(${sql.raw(`"${tableName}"`)})`.execute(db);
            if (pragmaResult.rows.length === 0)
                continue;
            const columns = pragmaResult.rows.map((r) => r.name);
            const types = {};
            for (const row of pragmaResult.rows) {
                types[row.name] = row.type || "TEXT";
            }
            schema[tableName] = { columns, types };
            let query = sql `SELECT * FROM ${sql.raw(`"${tableName}"`)}`;
            if (tableName.startsWith("ec_")) {
                query = sql `SELECT * FROM ${sql.raw(`"${tableName}"`)} WHERE deleted_at IS NULL AND status = 'published'`;
            }
            let rows = (await query.execute(db)).rows;
            if (tableName === "options") {
                rows = rows.filter((row) => SAFE_OPTIONS_PREFIXES.some(prefix => row.name.startsWith(prefix)));
            }
            if (rows.length > 0) {
                if (opts.origin && tableName.startsWith("ec_")) {
                    rows = rows.map((row) => {
                        const newRow = { ...row };
                        for (const [col, val] of Object.entries(newRow)) {
                            if (typeof val === 'string' && val.startsWith('{')) {
                                newRow[col] = injectMediaSrc(val, opts.origin);
                            }
                        }
                        return newRow;
                    });
                }
                tables[tableName] = rows;
            }
        }
        catch (e) {
            // Table might not exist yet
        }
    }
    return { tables, schema, generatedAt: new Date().toISOString() };
}
function injectMediaSrc(jsonStr, origin) {
    try {
        const obj = JSON.parse(jsonStr);
        if (typeof obj !== 'object' || obj === null)
            return jsonStr;
        let modified = false;
        const walk = (o) => {
            if ((o.provider === 'local' || (!o.provider && o.id && o.meta)) && !o.src) {
                const storageKey = o.meta?.storageKey ?? o.id;
                if (storageKey) {
                    o.src = `${origin}/_emdash/api/media/file/${storageKey}`;
                    modified = true;
                }
            }
            for (const k in o) {
                if (typeof o[k] === 'object' && o[k] !== null)
                    walk(o[k]);
            }
        };
        walk(obj);
        return modified ? JSON.stringify(obj) : jsonStr;
    }
    catch {
        return jsonStr;
    }
}
