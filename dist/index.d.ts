import type { StaticExportOptions } from "./descriptor.js";
export interface Snapshot {
    tables: Record<string, Record<string, unknown>[]>;
    schema: Record<string, {
        columns: string[];
        types?: Record<string, string>;
    }>;
    generatedAt: string;
}
export declare function createPlugin(options: StaticExportOptions): import("emdash").ResolvedPlugin<import("emdash").PluginStorageConfig>;
export default createPlugin;
