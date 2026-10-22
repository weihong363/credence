export type ReviewProfile = 'scoped' | 'full-review';
export const fullReviewCapabilities = ['repo.inventory', 'repo.architecture', 'repo.risk-review'] as const;
export interface PlanEntry { capabilityId: string; version: number; reason: string }
export interface ProcurementPlan { purchases: PlanEntry[] }
