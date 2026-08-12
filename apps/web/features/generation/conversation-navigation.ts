export function creationUrl(input: {
  agentId?: string | null;
  sessionId?: string | null;
  requirementRunId?: string | null;
  taskId?: string | null;
}) {
  const query = new URLSearchParams();
  if (input.agentId) query.set("agentId", input.agentId);
  if (input.sessionId) query.set("sessionId", input.sessionId);
  if (input.requirementRunId) query.set("requirementRunId", input.requirementRunId);
  if (input.taskId) query.set("taskId", input.taskId);
  const serialized = query.toString();
  return serialized ? `/create/image?${serialized}` : "/create/image";
}
