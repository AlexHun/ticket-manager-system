/**
 * Query key for the automation settings.
 *
 * One entry, and it stays its own key rather than nesting under `pipelineKeys`:
 * the settings are read by the pipeline page but they are not a slice of the
 * pipeline, and a finished run invalidating `["pipeline"]` has no business
 * refetching a setting nobody changed.
 */
export const automationKeys = {
  settings: ["automation", "settings"] as const,
};
