export function emdashStaticExport(options) {
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
