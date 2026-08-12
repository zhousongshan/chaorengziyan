export type SubmitAvailability = {
  disabled: boolean;
  busy: boolean;
  label: string;
  reason: string | null;
};

export function hasComposerInput(input: {
  text: string;
  productImageCount: number;
  referenceImageCount: number;
  editBaseImageCount?: number;
}): boolean {
  return Boolean(
    input.text.trim() ||
    input.productImageCount > 0 ||
    input.referenceImageCount > 0 ||
    (input.editBaseImageCount ?? 0) > 0
  );
}

export function deriveSubmitAvailability(input: {
  agentBindingRequired?: boolean;
  conversationProcessing: boolean;
  generationProcessing: boolean;
  cancellationPending: boolean;
  readinessLoading: boolean;
  generationServiceReady: boolean;
  projectLoading: boolean;
  projectReady: boolean;
  modelsLoading: boolean;
  hasModels: boolean;
  hasInput: boolean;
}): SubmitAvailability {
  if (input.agentBindingRequired) {
    return blocked("请先确认此旧会话属于当前 Agent", "等待绑定", false);
  }
  if (input.conversationProcessing) {
    return blocked("正在理解当前需求", "理解需求中", true);
  }
  if (input.cancellationPending) {
    return blocked("正在停止当前任务", "停止中", true);
  }
  if (input.generationProcessing) {
    return blocked("正在生成或检查图片", "生成中", true);
  }
  if (input.readinessLoading) {
    return blocked("正在检查创作服务", "检查服务", false);
  }
  if (!input.generationServiceReady) {
    return blocked("创作服务正在恢复，请稍后重试", "服务恢复中", false);
  }
  if (input.projectLoading) {
    return blocked("正在加载创作项目", "加载项目", false);
  }
  if (!input.projectReady) {
    return blocked("当前创作项目暂不可用", "项目不可用", false);
  }
  if (input.modelsLoading) {
    return blocked("正在加载生图模型", "加载模型", false);
  }
  if (!input.hasModels) {
    return blocked("当前没有可用的生图模型", "模型不可用", false);
  }
  if (!input.hasInput) {
    return blocked("请输入内容或添加图片", "发送", false);
  }
  return { disabled: false, busy: false, label: "发送", reason: null };
}

function blocked(reason: string, label: string, busy: boolean): SubmitAvailability {
  return { disabled: true, busy, label, reason };
}
