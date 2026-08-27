export const INSTAGRAM_NAMESPACE = "cf-instagram";

export function resolveInstagramNamespace(namespace) {
  const requested = typeof namespace === "string" ? namespace.trim() : "";
  if (!requested) return INSTAGRAM_NAMESPACE;
  if (requested !== INSTAGRAM_NAMESPACE) {
    throw new Error(
      `Instagram ingestion only supports namespace "${INSTAGRAM_NAMESPACE}"; received "${requested}".`,
    );
  }
  return INSTAGRAM_NAMESPACE;
}
