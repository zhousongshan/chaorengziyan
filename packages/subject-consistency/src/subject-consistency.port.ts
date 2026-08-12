import type {
  FinalRequirement,
  SubjectInspectionResult,
  SubjectRequirementReconciliation
} from "@chaoren/contracts";

export interface SubjectInspectionImage {
  mimeType: string;
  content: Buffer;
}

export interface SubjectInspectionInput {
  round: 1 | 2;
  originalUserText: string;
  requirement: FinalRequirement;
  sourceProducts: SubjectInspectionImage[];
  subjectEntities?: Array<{
    entityKey: string;
    label: string | null;
    sourceProductIndexes: number[];
  }>;
  generatedCandidate: SubjectInspectionImage;
  signal?: AbortSignal;
}

export interface SubjectInspectionOutputRepairInput {
  rawOutput: unknown;
  validationIssues: Array<{
    path: string;
    message: string;
  }>;
  signal?: AbortSignal;
}

export interface SubjectRequirementReconciliationInput {
  originalUserText: string;
  previousRequirement: FinalRequirement;
  inspectionResult: Extract<SubjectInspectionResult, { verdict: "failed" }>;
  signal?: AbortSignal;
}

export interface SubjectConsistencyPort {
  inspect(input: SubjectInspectionInput): Promise<unknown>;
  repairOutput?(input: SubjectInspectionOutputRepairInput): Promise<unknown>;
}

export interface SubjectRequirementReconcilerPort {
  reconcile(input: SubjectRequirementReconciliationInput): Promise<unknown>;
}

export interface ValidatedSubjectConsistencyPort {
  inspect(input: SubjectInspectionInput): Promise<SubjectInspectionResult>;
}

export interface ValidatedSubjectRequirementReconcilerPort {
  reconcile(
    input: SubjectRequirementReconciliationInput
  ): Promise<SubjectRequirementReconciliation>;
}
