/**
 * Tiny loader for `contracts/plutus.json`. We copy this file into
 * `web/public/contracts/plutus.json` at build/setup time so it can be
 * fetched as a static asset.
 *
 * The blueprint is the source of truth for compiled validator bytes and
 * datum / redeemer shapes. We only need the multi-handler `config.config.*`
 * compiled code here; the listing validator is also exposed for
 * forward-looking callers.
 */

export type PlutusBlueprint = {
  preamble: {
    title: string;
    description?: string;
    version?: string;
    plutusVersion: "v3" | "v2" | "v1";
    compiler?: { name: string; version: string };
    license?: string;
  };
  validators: PlutusValidator[];
  // (definitions are present but we don't need them at runtime)
};

export type PlutusValidator = {
  title: string;
  redeemer?: { title?: string; schema: unknown };
  datum?: { title?: string; schema: unknown };
  parameters?: { title: string; schema: unknown }[];
  compiledCode: string;
  hash: string;
};

let cached: PlutusBlueprint | null = null;

/**
 * Fetches /contracts/plutus.json once and caches it in module memory.
 *
 * <p>Uses {@code cache: "no-cache"} (revalidate with the server every
 * page load) instead of {@code "force-cache"}: the blueprint is small
 * (~6KB) and an HTTP-level revalidation is cheap, while a stale
 * {@code force-cache} hit silently produces the wrong applied-script
 * hash. The module-level {@code cached} variable still prevents repeat
 * fetches within a single session.
 */
export async function loadBlueprint(): Promise<PlutusBlueprint> {
  if (cached) return cached;
  const resp = await fetch("/contracts/plutus.json", { cache: "no-cache" });
  if (!resp.ok) {
    throw new Error(
      `failed to load /contracts/plutus.json: ${resp.status} ${resp.statusText}`,
    );
  }
  cached = (await resp.json()) as PlutusBlueprint;
  return cached;
}

export function getValidator(
  blueprint: PlutusBlueprint,
  title: string,
): PlutusValidator {
  const v = blueprint.validators.find((x) => x.title === title);
  if (!v) {
    throw new Error(`validator "${title}" not found in plutus blueprint`);
  }
  return v;
}
