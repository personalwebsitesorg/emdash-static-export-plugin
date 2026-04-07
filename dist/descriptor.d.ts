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
export declare function emdashStaticExport(options: StaticExportOptions): PluginDescriptor;
