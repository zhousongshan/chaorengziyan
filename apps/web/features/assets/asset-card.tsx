import type { MediaAssetListItem } from "@chaoren/contracts";
import {
  Download,
  Ellipsis,
  Heart,
  ImageIcon,
  ImageOff,
  LoaderCircle,
  MoveRight,
  Pencil,
  Trash2
} from "lucide-react";
import { useState } from "react";

import { apiClient } from "@/lib/api/client";
import { downloadMediaAsset } from "@/lib/download-media-asset";

import { formatAssetDate } from "./asset-formatters";
import styles from "./asset-library.module.css";
import { AssetThumbnail } from "./asset-thumbnail";

export function AssetCard({
  asset,
  onPreview,
  onToggleFavorite,
  onRename,
  onMove,
  onDelete,
  busy = false
}: Readonly<{
  asset: MediaAssetListItem;
  onPreview: (asset: MediaAssetListItem) => void;
  onToggleFavorite: (asset: MediaAssetListItem) => void;
  onRename: (asset: MediaAssetListItem) => void;
  onMove?: (asset: MediaAssetListItem) => void;
  onDelete: (asset: MediaAssetListItem) => void;
  busy?: boolean;
}>) {
  const [imageFailed, setImageFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloadPending, setDownloadPending] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const contentUrl = apiClient.mediaContentUrl(asset.id);

  return (
    <article className={styles.assetCard}>
      <div className={styles.assetPreview}>
        {imageFailed ? (
          <div className={styles.imageFallback} role="img" aria-label={`${asset.name} 加载失败`}>
            <ImageOff />
            <span>图片暂时无法显示</span>
          </div>
        ) : (
          <button
            className={styles.previewButton}
            type="button"
            onClick={() => onPreview(asset)}
            aria-label={`放大预览 ${asset.name}`}
          >
            <AssetThumbnail
              src={contentUrl}
              alt={asset.name}
              sizes="(max-width: 640px) 100vw, (max-width: 940px) 50vw, (max-width: 1280px) 33vw, 20vw"
              onError={() => setImageFailed(true)}
            />
          </button>
        )}
        <span className={styles.kindBadge}>
          <ImageIcon />
          图片
        </span>
        <button
          className={styles.favoriteButton}
          type="button"
          data-active={asset.favorite || undefined}
          disabled={busy}
          title={asset.favorite ? "取消收藏" : "收藏"}
          aria-label={`${asset.favorite ? "取消收藏" : "收藏"} ${asset.name}`}
          onClick={() => onToggleFavorite(asset)}
        >
          <Heart fill={asset.favorite ? "currentColor" : "none"} />
        </button>
      </div>
      <div className={styles.assetInfo}>
        <strong title={asset.name}>{asset.name}</strong>
        <div className={styles.assetMeta}>
          <span className={styles.sourcePill} data-source={asset.source}>
            {asset.source === "generated" ? "AI 生成" : "本地上传"}
          </span>
          <time dateTime={asset.createdAt}>{formatAssetDate(asset.createdAt)}</time>
        </div>
        {downloadError && (
          <p className={styles.downloadError} role="alert">
            {downloadError}
          </p>
        )}
        <div className={styles.assetActions}>
          <button type="button" onClick={() => onRename(asset)} disabled={busy}>
            <Pencil />
            重命名
          </button>
          {onMove && (
            <button type="button" onClick={() => onMove(asset)} disabled={busy}>
              <MoveRight />
              移动
            </button>
          )}
          <button
            type="button"
            disabled={busy || downloadPending}
            title="下载"
            onClick={() => {
              setDownloadPending(true);
              setDownloadError("");
              void downloadMediaAsset({
                url: contentUrl,
                name: asset.name,
                mimeType: asset.mimeType
              })
                .catch(() => setDownloadError("图片下载失败，请稍后重试"))
                .finally(() => setDownloadPending(false));
            }}
          >
            {downloadPending ? <LoaderCircle className="spin" /> : <Download />}
            {downloadPending ? "下载中" : "下载"}
          </button>
          <button
            className={styles.moreButton}
            type="button"
            aria-expanded={menuOpen}
            aria-label={`更多操作 ${asset.name}`}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Ellipsis />
          </button>
          {menuOpen && (
            <div className={styles.assetMenu} role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(asset);
                }}
              >
                <Trash2 />
                删除素材
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
