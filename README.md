# EmDash Static Export Plugin

A lightweight EmDash CMS plugin that automates the export of site data as a JSON snapshot to Cloudflare R2 whenever content is published or saved. Designed to power the **EmDash Static Build Architecture**, it enables an isolated static Astro frontend to build entirely from the JSON snapshot without querying the database in real-time.

## Features
- **Automated Snapshots**: Hooks into `content:afterSave` to generate a database snapshot dynamically.
- **Media URL Transformation**: Automatically rewrites internal EmDash media URLs (`/_emdash/api/media/file/`) to your public R2 bucket's domain for seamless frontend access.
- **Edge-Optimized Uploads**: Uses the extremely lightweight `aws4fetch` library to securely sign and upload JSON to a Cloudflare Workers R2 bucket utilizing the S3-compatible API. Fully compatible with Cloudflare Workers/Pages environments.
- **Deployment Webhooks**: Asynchronously triggers deployment hooks (e.g., Cloudflare Pages build hooks) after a successful snapshot upload.
- **Non-blocking Operations**: Offloads the generation and upload processes to background tasks to keep your CMS interface snappy.

## Requirements
- **EmDash CMS** core installed and configured.
- A **Cloudflare R2 Bucket**, along with an API token that has read/write permissions for the bucket.
- A static frontend builder (e.g., Cloudflare Pages) configured with a **Deploy Webhook URL**.

## Setup Instructions

1. Include the plugin within your `emdash-static` environment, making sure to build the plugin (`pnpm run build` or `tsc`).

2. Register the plugin within your `astro.config.mjs` where you initialize EmDash:
   ```javascript
   import { defineConfig } from "astro/config";
   import emdash from "emdash/astro";
   import { emdashStaticExport } from "emdash-static-export/dist/descriptor.js";

   export default defineConfig({
     integrations: [
       emdash({
         plugins: [
           emdashStaticExport({
             siteUrl: "https://your-frontend-site.com",
             mediaUrl: "https://media.your-frontend-site.com",
             deployHookUrl: "https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/...",
             r2AccountId: process.env.R2_ACCOUNT_ID,
             r2BucketName: "my-static-export-bucket",
             r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
             r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
           }),
         ],
       }),
     ],
   });
   ```

## Options Configuration

The plugin accepts the following configurations via the plugin descriptor:

| Option | Type | Description |
|--------|------|-------------|
| `siteUrl` | `string` | The public URL of the static frontend consuming the snapshot. |
| `mediaUrl` | `string` | The public URL domain masking your R2 storage bucket (e.g., `https://media.site.com`). All media instances are transformed to reference this domain. |
| `deployHookUrl` | `string` | The deploy hook endpoint to trigger a static rebuild (e.g., Cloudflare Pages or Vercel webhook URL). |
| `r2AccountId` | `string` | The Cloudflare Account ID associated with your R2 bucket. |
| `r2BucketName` | `string` | The name of the Cloudflare R2 bucket. |
| `r2AccessKeyId` | `string` | The Cloudflare R2 access key. |
| `r2SecretAccessKey`| `string` | The Cloudflare R2 secret access key. |

## How it Works

1. **Triggering**: An author saves, publishes, or archives a post within EmDash. This action prompts the `content:afterSave` hook.
2. **Snapshot Creation**: The plugin pulls the latest data structurally required for rendering using Emdash's internal `generateSnapshot` API function.
3. **Link Rewriting**: The local API media references (using the `/_emdash/api/media/file/` namespace) stored dynamically in Emdash blocks are string-replaced recursively, pointing out to your `mediaUrl` domain. 
4. **Edge Delivery Upload**: The plugin signs an S3 API `PUT` dispatch leveraging the minimalist `aws4fetch` Web Crypto library mapping the formatted JSON file into `exports/site-export.json`.
5. **Rebuild**: Your provided `deployHookUrl` gets POST-pinged alerting your static site environment that a new snapshot is available.
