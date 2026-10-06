const sdkSourceRoot = new URL("../packages/cambrian-sdk/src/", import.meta.url).href;

// Production uses bundler-style .js imports; resolve those to workspace TypeScript
// only in SDK source during Node's stripped-TypeScript tests.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && context.parentURL?.startsWith(sdkSourceRoot)
      && specifier.startsWith(".") && specifier.endsWith(".js")) {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
    throw error;
  }
}
