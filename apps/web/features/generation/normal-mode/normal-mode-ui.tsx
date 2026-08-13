import {
  ChevronDown,
  Images,
  ImageUp,
  LoaderCircle,
  Send,
  SlidersHorizontal,
  Undo2,
  WandSparkles,
  X
} from "lucide-react";
import Image from "next/image";
import {
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type RefObject,
  type ReactNode
} from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

import type { ImageModelDefinition } from "@chaoren/contracts";

import type { ImageInputDraft } from "@/stores/image-creation-draft.store";

import { shouldSubmitComposerOnEnter } from "./composer-keyboard";
import styles from "./normal-mode.module.css";

export type NormalModeSettingField =
  | "goal"
  | "imageCount"
  | "aspectRatio"
  | "style"
  | "quality"
  | "outputFormat"
  | "watermark"
  | "watermarkPosition";

export function NormalModeEmptyState({
  agentName,
  description
}: Readonly<{ agentName: string; description: string }>) {
  return (
    <div className={styles.emptyState}>
      <span className={styles.emptyAvatar}>AI</span>
      <h1>与 {agentName} 开始创作</h1>
      <p>{description}</p>
    </div>
  );
}

export function NormalModeComposer({
  fileInputRef,
  editBaseImage,
  productImages,
  textLength,
  busy,
  isDragging,
  models,
  selectedModelId,
  userTextRegistration,
  submitDisabled,
  submitLabel,
  submitUnavailableReason,
  optimization,
  optimizationPending,
  onModelChange,
  onOptimize,
  onUndoOptimization,
  onOptimizeAgain,
  onPaste,
  onDraggingChange,
  onFileChange,
  onDrop,
  onOpenAssetPicker,
  onRemoveEditBaseImage,
  onRemoveLocalImage
}: Readonly<{
  fileInputRef: RefObject<HTMLInputElement | null>;
  editBaseImage: ImageInputDraft | null;
  productImages: ImageInputDraft[];
  textLength: number;
  busy: boolean;
  isDragging: boolean;
  models: ImageModelDefinition[];
  selectedModelId: string;
  userTextRegistration: UseFormRegisterReturn;
  submitDisabled: boolean;
  submitLabel: string;
  submitUnavailableReason?: string;
  optimization: PromptOptimizationComposerState | null;
  optimizationPending: boolean;
  onModelChange: (modelId: string) => void;
  onOptimize: () => void;
  onUndoOptimization: () => void;
  onOptimizeAgain: () => void;
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  onDraggingChange: (dragging: boolean) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onOpenAssetPicker: () => void;
  onRemoveEditBaseImage: () => void;
  onRemoveLocalImage: (index: number) => void;
}>) {
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  return (
    <div className={styles.composerCard} data-dragging={isDragging || undefined} onPaste={onPaste}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        onChange={onFileChange}
        aria-label="上传商品主体图"
        hidden
      />

      {(editBaseImage || productImages.length > 0) && (
        <div className={styles.selectedImages}>
          {editBaseImage && (
            <div className={styles.selectedImage} data-kind="edit-base">
              <Image
                src={editBaseImage.previewUrl}
                alt="当前编辑底图"
                fill
                sizes="58px"
                unoptimized
              />
              <button type="button" aria-label="移除编辑底图" onClick={onRemoveEditBaseImage}>
                <X />
              </button>
              <span>编辑底图</span>
            </div>
          )}
          {productImages.map((productImage, index) => (
            <div className={styles.selectedImage} key={productImage.clientId}>
              <Image
                src={productImage.previewUrl}
                alt={`当前商品主体图 ${index + 1}`}
                fill
                sizes="58px"
                unoptimized
              />
              <button
                type="button"
                aria-label={`移除商品主体图 ${index + 1}`}
                onClick={() => onRemoveLocalImage(index)}
              >
                <X />
              </button>
              <span>商品图 {index + 1}</span>
            </div>
          ))}
        </div>
      )}

      <div
        className={styles.inputRow}
        onDragEnter={(event) => {
          event.preventDefault();
          onDraggingChange(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => onDraggingChange(false)}
        onDrop={onDrop}
      >
        <div
          className={styles.imageSourceControl}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setSourceMenuOpen(false);
          }}
        >
          <button
            className={styles.addImageButton}
            type="button"
            aria-label="添加商品图片"
            title="添加商品图片（最多4张）"
            aria-expanded={sourceMenuOpen}
            onClick={() => setSourceMenuOpen((open) => !open)}
          >
            +
          </button>
          {sourceMenuOpen && (
            <div className={styles.imageSourceMenu} role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setSourceMenuOpen(false);
                  fileInputRef.current?.click();
                }}
              >
                <ImageUp />
                <span>
                  <strong>本地上传</strong>
                  <small>从电脑中选择图片</small>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setSourceMenuOpen(false);
                  onOpenAssetPicker();
                }}
              >
                <Images />
                <span>
                  <strong>从资产库选择</strong>
                  <small>复用已上传或生成的图片</small>
                </span>
              </button>
            </div>
          )}
        </div>
        <div className={styles.textareaWrap}>
          <textarea
            maxLength={12_000}
            rows={1}
            placeholder="不会写指令，像找设计师一样描述需求即可…"
            disabled={busy}
            onKeyDown={(event) => {
              if (
                !shouldSubmitComposerOnEnter({
                  key: event.key,
                  shiftKey: event.shiftKey,
                  isComposing: event.nativeEvent.isComposing,
                  disabled: busy || submitDisabled
                })
              ) {
                return;
              }
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
            {...userTextRegistration}
          />
          <span>{textLength}/12000</span>
        </div>
      </div>

      {optimization && (
        <section className={styles.optimizationPanel} aria-label="提示词优化操作">
          <span>
            <WandSparkles />
            {optimization.pending ? "正在优化" : "已优化"}
          </span>
          {optimization.error && <p>{optimization.error}</p>}
          <div>
            <button type="button" disabled={optimization.pending} onClick={onUndoOptimization}>
              <Undo2 />
              撤回
            </button>
            <button type="button" disabled={optimization.pending} onClick={onOptimizeAgain}>
              <WandSparkles />
              再次优化
            </button>
          </div>
        </section>
      )}

      <div className={styles.composerActions}>
        <div className={styles.composerOptions}>
          <CompactSelect label="普通模式" ariaLabel="生成模式" disabled>
            <option>普通模式</option>
          </CompactSelect>
          <CompactSelect label="Skills 技能" ariaLabel="Skills 技能" disabled>
            <option>Skills 技能</option>
          </CompactSelect>
          <label className={styles.compactSelect}>
            <span>{models.find((model) => model.id === selectedModelId)?.name ?? "选择模型"}</span>
            <ChevronDown />
            <select
              aria-label="生图模型"
              value={selectedModelId}
              onChange={(event) => onModelChange(event.target.value)}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className={styles.optimizeButton}
            type="button"
            disabled={busy || optimizationPending || textLength === 0}
            onClick={onOptimize}
            title={textLength === 0 ? "请输入文字后再优化" : "优化当前提示词"}
          >
            {optimizationPending ? <LoaderCircle className="spin" /> : <WandSparkles />}
            {optimizationPending ? "正在优化" : "提示词优化"}
          </button>
        </div>
        <button
          className={styles.generateButton}
          type="submit"
          disabled={submitDisabled}
          aria-busy={busy || undefined}
          title={submitUnavailableReason ?? "发送"}
        >
          {busy ? <LoaderCircle className="spin" /> : <Send />}
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

export type PromptOptimizationComposerState = {
  pending: boolean;
  error: string | null;
};

function CompactSelect({
  label,
  ariaLabel,
  disabled,
  children
}: Readonly<{
  label: string;
  ariaLabel: string;
  disabled?: boolean;
  children: ReactNode;
}>) {
  return (
    <label className={styles.compactSelect}>
      <span>{label}</span>
      <ChevronDown />
      <select aria-label={ariaLabel} disabled={disabled}>
        {children}
      </select>
    </label>
  );
}

export function NormalModeReferencePanel({
  previewUrls,
  maxImages,
  prompt,
  onImageChange,
  onPaste,
  onRemoveImage,
  onPromptChange
}: Readonly<{
  previewUrls: string[];
  maxImages: number;
  prompt: string;
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLElement>) => void;
  onRemoveImage: (index: number) => void;
  onPromptChange: (value: string) => void;
}>) {
  return (
    <section className={styles.referencePanel} onPaste={onPaste}>
      <header>
        <strong>参考图（选填）</strong>
        <span>上传参考图并输入对应的修图提示词，可提升生成效果</span>
      </header>
      <div className={styles.referenceInputRow}>
        {previewUrls.map((previewUrl, index) => (
          <div className={styles.referencePreview} key={previewUrl}>
            <Image src={previewUrl} alt={`参考图预览 ${index + 1}`} fill sizes="44px" unoptimized />
            <button
              type="button"
              aria-label={`移除参考图 ${index + 1}`}
              onClick={() => onRemoveImage(index)}
            >
              <X />
            </button>
          </div>
        ))}
        {previewUrls.length < maxImages && (
          <label className={styles.referenceAdd}>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onImageChange}
              hidden
            />
            +
          </label>
        )}
        <div>
          <input
            value={prompt}
            maxLength={1_000}
            placeholder="输入对应的提示词 / Few-shot 提示…"
            onChange={(event) => onPromptChange(event.target.value)}
          />
          <span>{prompt.length}/1000</span>
        </div>
      </div>
    </section>
  );
}

export function NormalModeSettings({
  values,
  availableImageCounts,
  availableRatios,
  watermarkLogoPreviewUrl,
  agentInstruction,
  onValueChange,
  onWatermarkLogoChange,
  onAgentInstructionChange
}: Readonly<{
  values: {
    goal: string;
    imageCount: number;
    aspectRatio: string;
    style: string;
    quality: string;
    outputFormat: string;
    watermark: boolean;
    watermarkPosition: string;
  };
  availableImageCounts: readonly number[];
  availableRatios: readonly string[];
  watermarkLogoPreviewUrl: string | null;
  agentInstruction: string;
  onValueChange: (field: NormalModeSettingField, value: string | number | boolean) => void;
  onWatermarkLogoChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onAgentInstructionChange: (value: string) => void;
}>) {
  return (
    <aside className={styles.settingsPanel} aria-label="图片生成设置">
      <header className={styles.settingsHeader}>
        <span>
          <SlidersHorizontal />
        </span>
        <h2>图片生成设置</h2>
      </header>

      <div className={styles.settingsContent}>
        <SettingsSection title="内容与构图">
          <SettingSelect
            label="图片目标"
            value={values.goal}
            onChange={(value) => onValueChange("goal", value)}
          >
            <option value="营销海报">营销海报/活动宣传</option>
            <option value="商品主图">电商商品主图</option>
            <option value="详情页配图">详情页场景图</option>
            <option value="场景展示">社媒种草图</option>
          </SettingSelect>

          <SettingsGroup label="生成数量">
            <div className={styles.countGrid}>
              {availableImageCounts.map((count) => (
                <button
                  aria-label={`生成 ${count} 张图片`}
                  className={values.imageCount === count ? styles.selectedChoice : undefined}
                  key={count}
                  type="button"
                  onClick={() => onValueChange("imageCount", count)}
                >
                  {count}
                </button>
              ))}
            </div>
          </SettingsGroup>

          <SettingsGroup label="图片比例">
            <div className={styles.ratioGrid}>
              {availableRatios.map((ratio) => (
                <button
                  aria-label={`图片比例 ${ratio}`}
                  className={values.aspectRatio === ratio ? styles.selectedChoice : undefined}
                  key={ratio}
                  type="button"
                  onClick={() => onValueChange("aspectRatio", ratio)}
                >
                  <span className={styles[`ratio${ratio.replace(":", "")}`]} />
                  {ratio}
                </button>
              ))}
            </div>
          </SettingsGroup>
        </SettingsSection>

        <SettingsSection title="画面与输出">
          <SettingSelect
            label="图片风格"
            value={values.style}
            onChange={(value) => onValueChange("style", value)}
          >
            <option value="清新简约">清新可爱</option>
            <option value="真实摄影">写实风格</option>
            <option value="高级质感">高级极简</option>
            <option value="创意视觉">创意视觉</option>
          </SettingSelect>

          <SettingsGroup label="图片清晰度">
            <div className={styles.qualityGrid}>
              <button
                className={values.quality === "高清" ? styles.selectedChoice : undefined}
                type="button"
                onClick={() => onValueChange("quality", "高清")}
              >
                高清
              </button>
              <button type="button" disabled title="后续开放">
                超清
              </button>
              <button type="button" disabled title="后续开放">
                4K
              </button>
            </div>
          </SettingsGroup>

          <SettingSelect
            label="输出格式"
            value={values.outputFormat}
            onChange={(value) => onValueChange("outputFormat", value)}
          >
            <option value="PNG">PNG（高质量）</option>
            <option value="JPG">JPG（适合电商平台）</option>
            <option value="WEBP">WEBP（轻量高清）</option>
          </SettingSelect>
        </SettingsSection>

        <SettingsSection title="品牌水印">
          <SettingsGroup label="水印 Logo" inline>
            <button
              className={styles.toggle}
              data-enabled={values.watermark || undefined}
              type="button"
              role="switch"
              aria-checked={values.watermark}
              onClick={() => onValueChange("watermark", !values.watermark)}
            >
              <span />
            </button>
            <label className={styles.logoUpload}>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onWatermarkLogoChange}
                hidden
              />
              {watermarkLogoPreviewUrl ? (
                <Image
                  src={watermarkLogoPreviewUrl}
                  alt="水印 Logo"
                  width={96}
                  height={26}
                  unoptimized
                />
              ) : (
                <span>
                  <b>MINISO</b>
                  <small>名创优品</small>
                </span>
              )}
            </label>
          </SettingsGroup>

          <SettingSelect
            disabled={!values.watermark}
            label="水印位置"
            value={values.watermarkPosition}
            onChange={(value) => onValueChange("watermarkPosition", value)}
          >
            {["右下角", "左上角", "右上角", "左下角", "居中"].map((position) => (
              <option key={position}>{position}</option>
            ))}
          </SettingSelect>
        </SettingsSection>

        <SettingsSection title="Agent 设定">
          <div className={styles.agentInstruction}>
            <textarea
              aria-label="Agent 设定"
              value={agentInstruction}
              maxLength={1_000}
              placeholder="请输入角色身份、工作流步骤、生成约束、风格要求等内容。"
              onChange={(event) => onAgentInstructionChange(event.target.value)}
            />
            <span>{agentInstruction.length}/1000</span>
          </div>
        </SettingsSection>
      </div>
    </aside>
  );
}

function SettingsSection({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className={styles.settingsSection}>
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}

function SettingsGroup({
  label,
  inline = false,
  children
}: Readonly<{ label: string; inline?: boolean; children: ReactNode }>) {
  return (
    <section className={styles.settingsGroup} data-inline={inline || undefined}>
      <div className={styles.settingsLabel}>{label}</div>
      {children}
    </section>
  );
}

function SettingSelect({
  label,
  value,
  disabled = false,
  onChange,
  children
}: Readonly<{
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}>) {
  return (
    <label className={styles.settingsGroup} data-disabled={disabled || undefined}>
      <span className={styles.settingsLabel}>{label}</span>
      <span className={styles.settingSelect}>
        <select
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {children}
        </select>
        <ChevronDown />
      </span>
    </label>
  );
}
