import { ApiError } from "@/lib/api/client";

export type UserErrorAction =
  "retry" | "edit_requirement" | "replace_image" | "refresh" | "contact_support";

export type UserErrorPresentation = {
  title: string;
  message: string;
  action: UserErrorAction;
  actionLabel: string;
  retryable: boolean;
};

const fallbackError: UserErrorPresentation = {
  title: "任务处理失败",
  message: "暂时无法完成本次创作，请稍后重试。",
  action: "retry",
  actionLabel: "重新尝试",
  retryable: true
};

const userErrorCatalog: Record<string, UserErrorPresentation> = {
  CLIENT_NETWORK_UNAVAILABLE: {
    title: "网络连接异常",
    message: "请检查当前网络连接后重试。",
    action: "retry",
    actionLabel: "重新尝试",
    retryable: true
  },
  REQUIREMENT_AI_NOT_CONFIGURED: {
    title: "创作服务当前不可用",
    message: "服务尚未完成配置，请联系管理员。",
    action: "contact_support",
    actionLabel: "联系管理员",
    retryable: false
  },
  REQUIREMENT_AI_AUTH_FAILED: {
    title: "需求理解服务配置异常",
    message: "需求理解服务鉴权失败，请联系管理员。",
    action: "contact_support",
    actionLabel: "联系管理员",
    retryable: false
  },
  REQUIREMENT_AI_CAPABILITY_UNSUPPORTED: {
    title: "当前模型不支持需求理解",
    message: "当前模型不支持图片或结构化需求理解，请更换模型或联系管理员。",
    action: "contact_support",
    actionLabel: "联系管理员",
    retryable: false
  },
  REQUIREMENT_AI_TIMEOUT: {
    title: "需求理解等待时间过长",
    message: "本次需求理解未能及时完成，请稍后重新尝试。",
    action: "retry",
    actionLabel: "重新尝试",
    retryable: true
  },
  REQUIREMENT_AI_RATE_LIMITED: {
    title: "当前需求理解请求较多",
    message: "请稍后重新尝试本次需求。",
    action: "retry",
    actionLabel: "稍后重试",
    retryable: true
  },
  REQUIREMENT_AI_SERVICE_UNAVAILABLE: {
    title: "需求理解服务暂时不可用",
    message: "暂时无法完成需求理解，请稍后重新尝试。",
    action: "retry",
    actionLabel: "重新尝试",
    retryable: true
  },
  REQUIREMENT_AI_INVALID_RESPONSE: {
    title: "需求理解结果无效",
    message: "需求理解结果未通过程序校验，请重新尝试。",
    action: "retry",
    actionLabel: "重新尝试",
    retryable: true
  },
  REQUIREMENT_AI_REQUEST_FAILED: {
    title: "需求理解服务暂时不可用",
    message: "暂时无法理解本次需求，请稍后重试。",
    action: "retry",
    actionLabel: "重新尝试",
    retryable: true
  },
  CONVERSATION_TURN_FAILED: {
    title: "需求处理失败",
    message: "暂时无法完成本次需求处理，请稍后重试。",
    action: "retry",
    actionLabel: "重新尝试",
    retryable: true
  },
  CONVERSATION_TURN_INTERRUPTED: {
    title: "需求处理已中断",
    message: "处理进程意外中断，请重新尝试本次需求。",
    action: "retry",
    actionLabel: "重新尝试",
    retryable: true
  },
  CONVERSATION_TURN_QUEUE_UNAVAILABLE: {
    title: "需求任务队列暂时不可用",
    message: "需求任务多次投递失败，请稍后重新尝试。",
    action: "retry",
    actionLabel: "重新尝试",
    retryable: true
  },
  CONVERSATION_CONTEXT_LIMIT_EXCEEDED: {
    title: "当前会话内容过多",
    message: "请新建一个会话后继续创作。",
    action: "refresh",
    actionLabel: "新建会话",
    retryable: false
  },
  CONVERSATION_VERSION_CONFLICT: {
    title: "会话已在其他页面更新",
    message: "请刷新页面后继续。",
    action: "refresh",
    actionLabel: "刷新页面",
    retryable: true
  },
  CONVERSATION_BUSY: {
    title: "上一条需求仍在处理中",
    message: "请稍候，不要重复提交。",
    action: "retry",
    actionLabel: "稍后重试",
    retryable: true
  },
  PROMPT_OPTIMIZATION_NOT_CONFIGURED: {
    title: "提示词优化当前不可用",
    message: "服务尚未完成配置，请联系管理员。",
    action: "contact_support",
    actionLabel: "联系管理员",
    retryable: false
  },
  PROMPT_OPTIMIZATION_TIMEOUT: {
    title: "提示词优化等待时间过长",
    message: "本次优化未能及时完成，请重新尝试。",
    action: "retry",
    actionLabel: "重新优化",
    retryable: true
  },
  PROMPT_OPTIMIZATION_RATE_LIMITED: {
    title: "当前优化请求较多",
    message: "请稍后重新尝试。",
    action: "retry",
    actionLabel: "稍后重试",
    retryable: true
  },
  PROMPT_OPTIMIZATION_SERVICE_UNAVAILABLE: {
    title: "提示词优化服务暂时不可用",
    message: "请稍后重新尝试。",
    action: "retry",
    actionLabel: "重新优化",
    retryable: true
  },
  PROMPT_OPTIMIZATION_INVALID_RESPONSE: {
    title: "提示词优化结果无效",
    message: "优化结果未通过程序校验，请重新尝试。",
    action: "retry",
    actionLabel: "重新优化",
    retryable: true
  },
  PROMPT_OPTIMIZATION_CONTEXT_MISSING: {
    title: "当前创作上下文已变化",
    message: "请确认当前输入后重新优化。",
    action: "edit_requirement",
    actionLabel: "重新优化",
    retryable: false
  },
  PROMPT_OPTIMIZATION_IMAGE_NOT_AVAILABLE: {
    title: "部分图片已不可用",
    message: "请重新选择当前图片后再优化。",
    action: "replace_image",
    actionLabel: "重新选择",
    retryable: false
  },
  PROMPT_OPTIMIZATION_IMAGE_REQUIRED: {
    title: "需要选择图片",
    message: "当前文字提到了图片，但没有找到对应图片，请先选择需要处理的图片。",
    action: "replace_image",
    actionLabel: "选择图片",
    retryable: false
  },
  PROMPT_OPTIMIZATION_IMAGE_AMBIGUOUS: {
    title: "需要确认目标图片",
    message: "当前文字可能指向多张图片，请明确选择需要处理的图片。",
    action: "replace_image",
    actionLabel: "选择图片",
    retryable: false
  },
  PROMPT_OPTIMIZATION_PARENT_NOT_AVAILABLE: {
    title: "上一版优化结果已失效",
    message: "当前输入已经变化，请重新发起提示词优化。",
    action: "edit_requirement",
    actionLabel: "重新优化",
    retryable: false
  },
  PROMPT_OPTIMIZATION_IDEMPOTENCY_CONFLICT: {
    title: "优化请求已经变化",
    message: "请刷新当前输入后重新优化。",
    action: "refresh",
    actionLabel: "刷新页面",
    retryable: false
  },
  INVALID_PROMPT_OPTIMIZATION_INPUT: {
    title: "当前提示词无法优化",
    message: "请检查图片数量、生成数量和比例设置后再试。",
    action: "edit_requirement",
    actionLabel: "调整输入",
    retryable: false
  },
  PROMPT_OPTIMIZATION_FAILED: {
    title: "提示词优化失败",
    message: "暂时无法完成本次优化，请稍后重试。",
    action: "retry",
    actionLabel: "重新优化",
    retryable: true
  },
  IMAGE_PROVIDER_NOT_CONFIGURED: {
    title: "生图服务当前不可用",
    message: "服务尚未完成配置，请联系管理员。",
    action: "contact_support",
    actionLabel: "联系管理员",
    retryable: false
  },
  IMAGE_PROVIDER_AUTH_FAILED: {
    title: "生图服务鉴权失败",
    message: "当前生图服务密钥无效，请联系管理员检查配置。",
    action: "contact_support",
    actionLabel: "联系管理员",
    retryable: false
  },
  IMAGE_PROVIDER_ACCESS_DENIED: {
    title: "生图服务无访问权限",
    message: "当前账号没有完成本次生图所需的权限，请联系管理员。",
    action: "contact_support",
    actionLabel: "联系管理员",
    retryable: false
  },
  IMAGE_PROVIDER_UNAVAILABLE: {
    title: "生图服务暂时不可用",
    message: "请稍后重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  IMAGE_PROVIDER_REQUEST_FAILED: {
    title: "生图服务连接异常",
    message: "暂时无法连接生图服务，请稍后重试。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  IMAGE_GENERATION_FAILED: {
    title: "生图服务暂时不可用",
    message: "本次图片未能生成，请稍后重试。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  IMAGE_GENERATION_CANCELLED: {
    title: "任务已停止",
    message: "未完成的图片不会展示，你可以调整需求后重新生成。",
    action: "edit_requirement",
    actionLabel: "调整需求",
    retryable: false
  },
  IMAGE_PROVIDER_TIMEOUT: {
    title: "本次生成等待时间过长",
    message: "请重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  ASYNC_IMAGE_TIMEOUT: {
    title: "本次生成等待时间过长",
    message: "请重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  IMAGE_PROVIDER_RATE_LIMITED: {
    title: "当前生图任务较多",
    message: "请稍后重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  IMAGE_GENERATION_QUEUE_UNAVAILABLE: {
    title: "任务服务暂时繁忙",
    message: "请稍后重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  IMAGE_GENERATION_ALREADY_ACTIVE: {
    title: "当前已有生图任务",
    message: "请等待当前任务完成或先停止任务，再次生成所选结果。",
    action: "retry",
    actionLabel: "稍后重试",
    retryable: true
  },
  IMAGE_GENERATION_IDEMPOTENCY_CONFLICT: {
    title: "再次生成请求已发生变化",
    message: "请刷新页面后重新选择需要再次生成的结果。",
    action: "refresh",
    actionLabel: "刷新页面",
    retryable: false
  },
  IMAGE_GENERATION_TASK_NOT_FOUND: {
    title: "生图任务不存在",
    message: "当前任务已不可用，请刷新页面后重新生成。",
    action: "refresh",
    actionLabel: "刷新页面",
    retryable: false
  },
  IMAGE_GENERATION_UNIT_NOT_FOUND: {
    title: "生图输出已不可用",
    message: "当前图片任务缺少输出单元，请重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  IMAGE_GENERATION_TASK_DATA_CONFLICT: {
    title: "生图任务状态已变化",
    message: "当前任务状态已更新，请刷新页面后继续。",
    action: "refresh",
    actionLabel: "刷新页面",
    retryable: true
  },
  IMAGE_GENERATION_TASK_ALREADY_FINISHED: {
    title: "生图任务已结束",
    message: "当前任务已经完成或停止，请刷新页面查看最新结果。",
    action: "refresh",
    actionLabel: "刷新页面",
    retryable: false
  },
  IMAGE_GENERATION_OUTPUT_NOT_FOUND: {
    title: "所选结果已不可用",
    message: "请刷新页面后重新选择结果。",
    action: "refresh",
    actionLabel: "刷新页面",
    retryable: false
  },
  IMAGE_GENERATION_OUTPUT_NOT_READY: {
    title: "所选结果尚未完成",
    message: "请等待生成和图片检查完成后再试。",
    action: "refresh",
    actionLabel: "刷新状态",
    retryable: true
  },
  IMAGE_GENERATION_OUTPUT_CHANGED: {
    title: "所选结果已经更新",
    message: "请刷新页面并确认最新结果后再试。",
    action: "refresh",
    actionLabel: "刷新页面",
    retryable: true
  },
  IMAGE_MODEL_NOT_AVAILABLE: {
    title: "所选生图模型暂时不可用",
    message: "请更换模型或稍后重试。",
    action: "edit_requirement",
    actionLabel: "调整设置",
    retryable: false
  },
  IMAGE_PROVIDER_NOT_SUPPORTED: {
    title: "所选生图模型暂时不可用",
    message: "请更换模型或联系管理员。",
    action: "edit_requirement",
    actionLabel: "调整设置",
    retryable: false
  },
  INVALID_IMAGE_PROVIDER_RESPONSE: invalidGeneratedImage(),
  INCOMPLETE_IMAGE_PROVIDER_RESPONSE: invalidGeneratedImage(),
  ASYNC_IMAGE_GENERATION_FAILED: {
    title: "生图服务未能完成本次生成",
    message: "请调整需求或稍后重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  ASYNC_IMAGE_SUBMISSION_FAILED: {
    title: "生图服务暂时不可用",
    message: "生图任务未能提交，请稍后重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  ASYNC_IMAGE_RESULT_FAILED: {
    title: "生图服务连接异常",
    message: "暂时无法获取生图结果，请稍后重试。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  IMAGE_DOWNLOAD_FAILED: {
    title: "生图结果下载失败",
    message: "生图已完成，但暂时无法下载结果，请重试。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  IMAGE_DOWNLOAD_URL_REJECTED: {
    title: "生图结果地址无法验证",
    message: "生图服务返回的结果地址未通过安全校验，请重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  IMAGE_DOWNLOAD_REDIRECT_LIMIT: {
    title: "生图结果地址无效",
    message: "生图结果无法安全下载，请重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  INVALID_GENERATION_UNIT_OUTPUT_COUNT: {
    title: "生图结果数量无效",
    message: "生图服务返回的图片数量不符合本次任务，请重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  INVALID_IMAGE_RESUME_REQUEST: {
    title: "上次生图任务无法恢复",
    message: "系统无法安全继续上次任务，请重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  IMAGE_DOWNLOAD_RETURNED_NON_IMAGE: invalidGeneratedImage(),
  IMAGE_BINARY_SIGNATURE_INVALID: invalidGeneratedImage(),
  IMAGE_MIME_TYPE_MISMATCH: invalidGeneratedImage(),
  IMAGE_DECODE_FAILED: invalidGeneratedImage(),
  INVALID_GENERATED_IMAGE_SIZE: invalidGeneratedImage(),
  INVALID_GENERATED_IMAGE_CONTENT: invalidGeneratedImage(),
  INVALID_GENERATED_CANDIDATE: invalidGeneratedImage(),
  INVALID_SOURCE_PRODUCT_IMAGE: {
    title: "商品图片无法读取",
    message: "请更换一张可正常打开的 PNG、JPEG 或 WebP 图片。",
    action: "replace_image",
    actionLabel: "更换图片",
    retryable: false
  },
  SOURCE_IMAGE_REPLACEMENT_REQUIRED: {
    title: "商品图片不够清晰",
    message: "请更换一张主体更清晰的商品图片后重新生成。",
    action: "replace_image",
    actionLabel: "更换图片",
    retryable: false
  },
  SUBJECT_INSPECTION_INCONCLUSIVE: {
    title: "图片检查未能得出结论",
    message: "本次结果无法确认是否保持了商品主体，请重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  QUALITY_ENTITY_LINEAGE_INVALID: {
    title: "商品关系需要重新选择",
    message: "当前结果无法确认每个商品对应的原图，请重新选择商品原图后生成。",
    action: "replace_image",
    actionLabel: "重新选择",
    retryable: false
  },
  GENERATION_PLAN_CONTEXT_CONFLICT: {
    title: "本次需求需要重新整理",
    message: "当前执行计划缺少完整的本次需求，请重新提交生成要求。",
    action: "edit_requirement",
    actionLabel: "修改需求",
    retryable: false
  },
  GENERATION_EXECUTION_PLAN_UNAVAILABLE: {
    title: "本次执行计划不完整",
    message: "当前图片缺少冻结执行信息，请重新提交需求后生成。",
    action: "edit_requirement",
    actionLabel: "重新提交",
    retryable: false
  },
  GENERATION_SOURCE_NOT_DELIVERABLE: {
    title: "这张图片暂时不能继续使用",
    message: "该图片尚未通过检查或已被拒绝，请选择可用成品或重新上传商品原图。",
    action: "replace_image",
    actionLabel: "重新选择",
    retryable: false
  },
  QUALITY_ENTITY_LINEAGE_MISSING: {
    title: "商品关系需要重新选择",
    message: "历史结果缺少可继承的商品原图关系，请重新选择商品原图后生成。",
    action: "replace_image",
    actionLabel: "重新选择",
    retryable: false
  },
  SOURCE_IMAGE_NOT_AVAILABLE: {
    title: "商品原图已不可用",
    message: "请重新选择商品原图后生成。",
    action: "replace_image",
    actionLabel: "重新选择",
    retryable: false
  },
  SOURCE_UNUSABLE: {
    title: "商品原图无法用于检查",
    message: "请更换一张更清晰、完整的商品原图。",
    action: "replace_image",
    actionLabel: "更换图片",
    retryable: false
  },
  REQUIREMENT_NEEDS_CLARIFICATION: {
    title: "还需要确认需求",
    message: "请先回答当前需求中的确认问题，再开始生成。",
    action: "edit_requirement",
    actionLabel: "补充需求",
    retryable: false
  },
  REQUIREMENT_MODEL_CONSTRAINT_CHANGED: {
    title: "模型设置已发生变化",
    message: "当前需求与所选模型设置不一致，请刷新后重新生成。",
    action: "refresh",
    actionLabel: "刷新页面",
    retryable: true
  },
  GENERATION_PLAN_VERSION_UNSUPPORTED: {
    title: "本次执行计划已过期",
    message: "请重新提交当前需求后生成。",
    action: "edit_requirement",
    actionLabel: "重新提交",
    retryable: false
  },
  GENERATION_PLAN_OUTPUT_COUNT_MISMATCH: {
    title: "生成数量计划无效",
    message: "当前需求的输出数量未通过程序校验，请重新提交。",
    action: "edit_requirement",
    actionLabel: "调整需求",
    retryable: false
  },
  SUBJECT_CHECK_LINEAGE_CONFLICT: {
    title: "商品关系无法确认",
    message: "本次任务中的商品与原图关系不一致，请重新选择商品原图后生成。",
    action: "replace_image",
    actionLabel: "重新选择",
    retryable: false
  },
  SUBJECT_CHECK_EXECUTION_PLAN_UNAVAILABLE: {
    title: "图片检查计划不完整",
    message: "当前图片缺少生成时的冻结需求，请重新提交需求后生成。",
    action: "edit_requirement",
    actionLabel: "重新提交",
    retryable: false
  },
  SUBJECT_CHECK_LINEAGE_NOT_AVAILABLE: {
    title: "商品关系无法确认",
    message: "本次任务缺少可用的商品原图关系，请重新选择商品原图后生成。",
    action: "replace_image",
    actionLabel: "重新选择",
    retryable: false
  },
  SUBJECT_REPAIR_LINEAGE_CONFLICT: {
    title: "商品修复关系异常",
    message: "自动修复无法确认原商品关系，请重新选择商品原图后生成。",
    action: "replace_image",
    actionLabel: "重新选择",
    retryable: false
  },
  SUBJECT_CONSISTENCY_FAILED: {
    title: "生成结果未能保持商品主体",
    message: "请调整需求或更换商品图片后重新生成。",
    action: "edit_requirement",
    actionLabel: "修改需求",
    retryable: false
  },
  SUBJECT_AI_REQUEST_FAILED: {
    title: "图片检查服务暂时不可用",
    message: "请稍后重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  SUBJECT_AI_TIMEOUT: {
    title: "图片检查等待时间过长",
    message: "本次图片检查未能及时完成，请重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  SUBJECT_AI_RATE_LIMITED: {
    title: "当前图片检查请求较多",
    message: "请稍后重新生成。",
    action: "retry",
    actionLabel: "稍后重试",
    retryable: true
  },
  SUBJECT_AI_SERVICE_UNAVAILABLE: {
    title: "图片检查服务暂时不可用",
    message: "请稍后重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  SUBJECT_CHECK_REQUIREMENT_NOT_AVAILABLE: {
    title: "主体检查需求已不可用",
    message: "当前任务缺少可用的商品需求，请重新生成。",
    action: "edit_requirement",
    actionLabel: "修改需求",
    retryable: false
  },
  SUBJECT_CHECK_IMAGE_NOT_AVAILABLE: {
    title: "主体检查图片已不可用",
    message: "请重新选择商品原图后生成。",
    action: "replace_image",
    actionLabel: "重新选择",
    retryable: false
  },
  QUALITY_SOURCE_IMAGE_NOT_AVAILABLE: {
    title: "商品原图已不可用",
    message: "请重新选择商品原图后生成。",
    action: "replace_image",
    actionLabel: "重新选择",
    retryable: false
  },
  SUBJECT_CONSISTENCY_EXECUTION_FAILED: {
    title: "图片检查未能完成",
    message: "本次图片检查未能完成，请稍后重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  SUBJECT_REPAIR_QUEUE_NOT_CONFIGURED: {
    title: "主体修复服务当前不可用",
    message: "主体修复队列尚未完成配置，请联系管理员。",
    action: "contact_support",
    actionLabel: "联系管理员",
    retryable: false
  },
  SUBJECT_REPAIR_GENERATION_FAILED: {
    title: "商品主体自动修复失败",
    message: "自动修复没有完成，请重新生成或调整需求。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  SUBJECT_CONSISTENCY_CHECK_FAILED: {
    title: "图片检查服务暂时不可用",
    message: "请稍后重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  },
  SUBJECT_INSPECTION_NOT_CONFIGURED: {
    title: "图片检查服务当前不可用",
    message: "服务尚未完成配置，请联系管理员。",
    action: "contact_support",
    actionLabel: "联系管理员",
    retryable: false
  },
  SUBJECT_CONSISTENCY_QUEUE_UNAVAILABLE: {
    title: "图片检查服务暂时繁忙",
    message: "系统会继续处理，也可以稍后刷新查看结果。",
    action: "refresh",
    actionLabel: "刷新状态",
    retryable: true
  },
  DELIVERY_IMAGE_PROCESSING_FAILED: {
    title: "图片交付处理失败",
    message: "图片已通过检查，但格式转换或水印处理失败，请重试。",
    action: "retry",
    actionLabel: "重新尝试",
    retryable: true
  },
  WATERMARK_IMAGE_NOT_AVAILABLE: {
    title: "水印 Logo 不可用",
    message: "请重新上传水印 Logo，或关闭水印后重试。",
    action: "edit_requirement",
    actionLabel: "调整设置",
    retryable: false
  }
};

export function presentUserError(error: unknown): UserErrorPresentation {
  if (error instanceof TypeError && error.message === "Failed to fetch") {
    return userErrorCatalog.CLIENT_NETWORK_UNAVAILABLE!;
  }
  if (error instanceof ApiError) return presentUserErrorCode(error.code);
  if (hasErrorCode(error)) return presentUserErrorCode(error.code);
  return fallbackError;
}

export function presentUserErrorCode(code: string | null | undefined): UserErrorPresentation {
  return (code ? userErrorCatalog[code] : undefined) ?? fallbackError;
}

function invalidGeneratedImage(): UserErrorPresentation {
  return {
    title: "生图服务返回的图片无效",
    message: "本次结果无法读取，请重新生成。",
    action: "retry",
    actionLabel: "重新生成",
    retryable: true
  };
}

function hasErrorCode(error: unknown): error is { code: string } {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  );
}
