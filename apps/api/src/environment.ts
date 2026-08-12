import { environmentSchema, type Environment } from "@chaoren/contracts";

export const ENVIRONMENT = Symbol("ENVIRONMENT");

export function readEnvironment(): Environment {
  const result = environmentSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`环境变量配置无效: ${result.error.message}`);
  }
  return result.data;
}
