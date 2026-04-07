import type { PluginDescriptor } from "emdash";

export interface StaticExportOptions extends Record<string, unknown> {
  siteUrl: string;
  mediaUrl: string;
  deployHookUrl: string;
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2BucketName: string;
}

export function emdashStaticExport(options: StaticExportOptions): PluginDescriptor {
  if (!options.deployHookUrl || !options.mediaUrl || !options.r2AccountId || !options.r2AccessKeyId || !options.r2SecretAccessKey || !options.r2BucketName) {
    console.warn("[emdash-static-export] WARNING: Missing required options!");
  }

  return {
    id: "emdash-static-export",
    version: "1.0.0",
    entrypoint: "emdash-static-export",
    options,
  };
}
