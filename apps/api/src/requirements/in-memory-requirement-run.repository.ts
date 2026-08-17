import { Injectable } from "@nestjs/common";

import type {
  RequirementRunRecord,
  RequirementRunRepository
} from "./requirement-run.repository.js";

@Injectable()
export class InMemoryRequirementRunRepository implements RequirementRunRepository {
  private readonly records = new Map<string, RequirementRunRecord>();

  public save(record: RequirementRunRecord): Promise<void> {
    this.records.set(record.id, structuredClone(record));
    return Promise.resolve();
  }

  public findById(id: string): Promise<RequirementRunRecord | undefined> {
    const record = this.records.get(id);
    return Promise.resolve(record ? structuredClone(record) : undefined);
  }

  public findPresentationContextById(id: string): Promise<
    | {
        parentRequirementRunId: string | null;
        productImageCount: number;
      }
    | undefined
  > {
    const record = this.records.get(id);
    return Promise.resolve(
      record
        ? {
            parentRequirementRunId: record.parentRequirementRunId ?? null,
            productImageCount: record.request.productImageIds.length
          }
        : undefined
    );
  }
}
