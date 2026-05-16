/**
 * Maintenance-mode flag.
 *
 * <p>Toggled by setting the Vercel env var {@code MAINTENANCE_MODE} to
 * exactly the string {@code "true"} (anything else, including unset, is
 * treated as off). Vercel auto-redeploys when an env var changes from
 * its dashboard — flip-time is the build + deploy cycle (~90s), not
 * instant. That's fine for the planned-maintenance use case; if we ever
 * need sub-minute toggling we'd migrate to Vercel Edge Config.
 *
 * <p>Read server-side only (no {@code NEXT_PUBLIC_} prefix), so the
 * value never lands in the client bundle.
 */
export function isMaintenanceMode(): boolean {
  return process.env.MAINTENANCE_MODE === "true";
}
