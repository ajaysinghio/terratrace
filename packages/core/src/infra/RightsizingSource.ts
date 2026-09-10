import type { CloudProvider, RightsizingRecommendation } from "../types.js";

/**
 * Interface for a source of rightsizing recommendations (AWS Compute
 * Optimizer today; a live-fetch variant, or a GCP/Azure equivalent, is a
 * separate implementation of this same interface — see AWSCurSource vs
 * AWSCurS3Source in ../billing/ for the precedent).
 */
export interface RightsizingSource {
  readonly provider: CloudProvider;
  fetchRecommendations(): Promise<RightsizingRecommendation[]>;
}