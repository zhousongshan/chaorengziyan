"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BrainCircuit,
  Check,
  FilePenLine,
  Eye,
  EyeOff,
  ImageIcon,
  KeyRound,
  LoaderCircle,
  RefreshCcw,
  Save,
  ScanSearch,
  Server,
  ShieldCheck,
  TriangleAlert
} from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";

import { Button } from "@/components/ui/button";

import {
  modelSettingsFormSchema,
  modelSettingsResponseSchema,
  type ModelSettingsFormValues,
  type ModelSettingsResponse
} from "./model-settings.schema";

const queryKey = ["model-settings"] as const;

export function ModelSettingsPanel() {
  const queryClient = useQueryClient();
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const form = useForm<ModelSettingsFormValues>({
    resolver: zodResolver(modelSettingsFormSchema),
    defaultValues: {
      promptOptimizationBaseUrl: "https://jennyapi.site/v1",
      promptOptimizationApiKey: "",
      promptOptimizationModel: "gpt-5.6-sol",
      requirementBaseUrl: "https://jennyapi.site/v1",
      requirementApiKey: "",
      requirementModel: "gpt-5.6-sol",
      imageBaseUrl: "https://jennyapi.site/v1",
      imageApiKey: "",
      inspectionBaseUrl: "https://jennyapi.site/v1",
      inspectionApiKey: ""
    }
  });
  const settingsQuery = useQuery({
    queryKey,
    queryFn: loadModelSettings
  });
  const saveMutation = useMutation({
    mutationFn: saveModelSettings,
    onSuccess: (response) => {
      queryClient.setQueryData(queryKey, response);
      form.reset({
        promptOptimizationBaseUrl: response.models.promptOptimization.baseUrl,
        promptOptimizationApiKey: "",
        promptOptimizationModel: response.models.promptOptimization.model,
        requirementBaseUrl: response.models.requirement.baseUrl,
        requirementApiKey: "",
        requirementModel: response.models.requirement.model,
        imageBaseUrl: response.models.image.baseUrl,
        imageApiKey: "",
        inspectionBaseUrl: response.models.inspection.baseUrl,
        inspectionApiKey: ""
      });
      setSavedMessage("配置已写入 .env。重启 API 和 Worker 后生效。");
    }
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    form.reset({
      promptOptimizationBaseUrl: settingsQuery.data.models.promptOptimization.baseUrl,
      promptOptimizationApiKey: "",
      promptOptimizationModel: settingsQuery.data.models.promptOptimization.model,
      requirementBaseUrl: settingsQuery.data.models.requirement.baseUrl,
      requirementApiKey: "",
      requirementModel: settingsQuery.data.models.requirement.model,
      imageBaseUrl: settingsQuery.data.models.image.baseUrl,
      imageApiKey: "",
      inspectionBaseUrl: settingsQuery.data.models.inspection.baseUrl,
      inspectionApiKey: ""
    });
  }, [form, settingsQuery.data]);

  if (settingsQuery.isPending) {
    return (
      <div className="model-settings-state">
        <LoaderCircle className="is-spinning" />
        <strong>正在读取本地模型配置</strong>
      </div>
    );
  }
  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <div className="model-settings-state is-error">
        <TriangleAlert />
        <strong>模型配置读取失败</strong>
        <p>{errorMessage(settingsQuery.error)}</p>
        <Button variant="secondary" onClick={() => settingsQuery.refetch()}>
          <RefreshCcw />
          重新读取
        </Button>
      </div>
    );
  }

  const configuredCount = Object.values(settingsQuery.data.models).filter(
    (model) => model.apiKeyConfigured
  ).length;

  return (
    <section className="model-settings-page">
      <header className="model-settings-hero">
        <div>
          <span>系统设置 / 模型配置</span>
          <h1>模型与 API Key</h1>
          <p>四个业务节点独立运行。测试期提示词优化继承需求理解模型，后续可单独切换。</p>
        </div>
        <div className="model-config-summary">
          <ShieldCheck />
          <span>当前配置</span>
          <strong>{configuredCount}/4 个节点可用</strong>
        </div>
      </header>

      <div className="model-settings-notice">
        <KeyRound />
        <div>
          <strong>安全规则</strong>
          <p>留空 Key 会保留原值；只有输入新 Key 时才会替换。页面永远不会读取或显示旧 Key。</p>
        </div>
      </div>

      <form
        className="model-settings-form"
        onSubmit={form.handleSubmit((values) => {
          setSavedMessage(null);
          saveMutation.mutate(values);
        })}
      >
        <ModelConfigurationCard
          accent="amber"
          icon={FilePenLine}
          step="01"
          role="提示词优化"
          description="结合文字、商品图、参考图和有限上下文优化提示词，不改变用户明确要求。"
          provider={settingsQuery.data.models.promptOptimization.provider}
          model={settingsQuery.data.models.promptOptimization.model}
          configured={settingsQuery.data.models.promptOptimization.apiKeyConfigured}
          configurationMode={settingsQuery.data.models.promptOptimization.configurationMode}
          baseUrlRegistration={form.register("promptOptimizationBaseUrl")}
          apiKeyRegistration={form.register("promptOptimizationApiKey")}
          modelRegistration={form.register("promptOptimizationModel")}
          baseUrlError={form.formState.errors.promptOptimizationBaseUrl?.message}
          modelError={form.formState.errors.promptOptimizationModel?.message}
        />
        <ModelConfigurationCard
          accent="violet"
          icon={BrainCircuit}
          step="02"
          role="多模态需求识别与会话记忆"
          description="同时读取文字、商品图、参考图和会话上下文，整理需求并记录图片语义。"
          provider={settingsQuery.data.models.requirement.provider}
          model={settingsQuery.data.models.requirement.model}
          configured={settingsQuery.data.models.requirement.apiKeyConfigured}
          baseUrlRegistration={form.register("requirementBaseUrl")}
          apiKeyRegistration={form.register("requirementApiKey")}
          modelRegistration={form.register("requirementModel")}
          baseUrlError={form.formState.errors.requirementBaseUrl?.message}
          modelError={form.formState.errors.requirementModel?.message}
        />
        <ModelConfigurationCard
          accent="blue"
          icon={ImageIcon}
          step="03"
          role="商品图片生成"
          description="读取已确认需求和商品主体图，生成最终电商创意图片。"
          provider={settingsQuery.data.models.image.provider}
          model={settingsQuery.data.models.image.model}
          configured={settingsQuery.data.models.image.apiKeyConfigured}
          baseUrlRegistration={form.register("imageBaseUrl")}
          apiKeyRegistration={form.register("imageApiKey")}
          baseUrlError={form.formState.errors.imageBaseUrl?.message}
        />
        <ModelConfigurationCard
          accent="emerald"
          icon={ScanSearch}
          step="04"
          role="主体一致性质检"
          description="同时读取商品原图、生成图和确认需求，判断未经授权的主体变化。"
          provider={settingsQuery.data.models.inspection.provider}
          model={settingsQuery.data.models.inspection.model}
          configured={settingsQuery.data.models.inspection.apiKeyConfigured}
          baseUrlRegistration={form.register("inspectionBaseUrl")}
          apiKeyRegistration={form.register("inspectionApiKey")}
          baseUrlError={form.formState.errors.inspectionBaseUrl?.message}
        />

        <footer className="model-settings-actions">
          <div aria-live="polite">
            {savedMessage && (
              <p className="model-save-success">
                <Check />
                {savedMessage}
              </p>
            )}
            {saveMutation.isError && (
              <p className="model-save-error">
                <TriangleAlert />
                {errorMessage(saveMutation.error)}
              </p>
            )}
            {!savedMessage && !saveMutation.isError && (
              <p>保存只更新本地配置文件，不会自动发起模型调用。</p>
            )}
          </div>
          <Button type="submit" size="lg" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <LoaderCircle className="is-spinning" /> : <Save />}
            保存模型配置
          </Button>
        </footer>
      </form>
    </section>
  );
}

interface ModelConfigurationCardProps {
  accent: "amber" | "violet" | "blue" | "emerald";
  icon: ComponentType<{ className?: string }>;
  step: string;
  role: string;
  description: string;
  provider: string;
  model: string;
  configured: boolean;
  configurationMode?: "inherited" | "dedicated";
  baseUrlRegistration: UseFormRegisterReturn;
  apiKeyRegistration: UseFormRegisterReturn;
  modelRegistration?: UseFormRegisterReturn;
  baseUrlError: string | undefined;
  modelError?: string | undefined;
}

function ModelConfigurationCard({
  accent,
  icon: Icon,
  step,
  role,
  description,
  provider,
  model,
  configured,
  configurationMode,
  baseUrlRegistration,
  apiKeyRegistration,
  modelRegistration,
  baseUrlError,
  modelError
}: ModelConfigurationCardProps) {
  const [showKey, setShowKey] = useState(false);
  return (
    <article className={`model-config-card is-${accent}`}>
      <header>
        <span className="model-config-icon">
          <Icon />
        </span>
        <div>
          <small>MODEL {step}</small>
          <h2>{role}</h2>
          <p>{description}</p>
        </div>
        <span className={configured ? "model-key-status is-ready" : "model-key-status"}>
          {configured ? <Check /> : <TriangleAlert />}
          {configurationMode === "inherited"
            ? "测试期继承"
            : configured
              ? "Key 已配置"
              : "Key 未配置"}
        </span>
      </header>

      <div className="model-identity-row">
        <div>
          <span>服务商</span>
          <strong>{provider}</strong>
        </div>
        <div>
          <span>{modelRegistration ? "模型 ID" : "固定模型 ID"}</span>
          {modelRegistration ? (
            <>
              <input className="model-id-input" {...modelRegistration} />
              {modelError && <small className="model-field-error">{modelError}</small>}
            </>
          ) : (
            <code>{model}</code>
          )}
        </div>
      </div>

      <div className="model-field-grid">
        <label>
          <span>
            <Server />
            API Base URL
          </span>
          <input type="url" autoComplete="url" {...baseUrlRegistration} />
          {baseUrlError && <small>{baseUrlError}</small>}
        </label>
        <label>
          <span>
            <KeyRound />
            API Key
          </span>
          <div className="secret-input">
            <input
              type={showKey ? "text" : "password"}
              autoComplete="new-password"
              placeholder={configured ? "已配置；留空保持原值" : "请输入 API Key"}
              {...apiKeyRegistration}
            />
            <button
              type="button"
              aria-label={showKey ? "隐藏新 Key" : "显示新 Key"}
              onClick={() => setShowKey((visible) => !visible)}
            >
              {showKey ? <EyeOff /> : <Eye />}
            </button>
          </div>
        </label>
      </div>
    </article>
  );
}

async function loadModelSettings(): Promise<ModelSettingsResponse> {
  const response = await fetch("/api/model-settings", { cache: "no-store" });
  if (!response.ok) throw new Error(await responseError(response));
  return modelSettingsResponseSchema.parse(await response.json());
}

async function saveModelSettings(values: ModelSettingsFormValues): Promise<ModelSettingsResponse> {
  const response = await fetch("/api/model-settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(values)
  });
  if (!response.ok) throw new Error(await responseError(response));
  return modelSettingsResponseSchema.parse(await response.json());
}

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  return typeof body?.message === "string" ? body.message : `请求失败 (${response.status})`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误";
}
