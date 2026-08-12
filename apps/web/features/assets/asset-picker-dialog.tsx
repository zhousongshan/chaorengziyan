"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { MediaAssetListItem } from "@chaoren/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Folder,
  Images,
  Search,
  X
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";

import { remainingAssetSelectionCapacity } from "./asset-selection";
import { AssetThumbnail } from "./asset-thumbnail";
import styles from "./asset-picker-dialog.module.css";

type PickerScope = "all" | "favorites";
type PickerSource = "all" | "uploaded" | "generated";

export function AssetPickerDialog({
  open,
  projectId,
  maxSelection,
  excludedAssetIds,
  onOpenChange,
  onConfirm
}: Readonly<{
  open: boolean;
  projectId: string | null;
  maxSelection: number;
  excludedAssetIds: Set<string>;
  onOpenChange: (open: boolean) => void;
  onConfirm: (assets: MediaAssetListItem[]) => void;
}>) {
  const [scope, setScope] = useState<PickerScope>("all");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState<PickerSource>("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Map<string, MediaAssetListItem>>(new Map());
  const [notice, setNotice] = useState("");
  const atFavoriteRoot = scope === "favorites" && folderId === null;
  const query = {
    keyword,
    scope,
    ...(folderId ? { folderId } : {}),
    ...(projectId ? { projectId } : {}),
    source,
    sort: "newest" as const,
    page,
    pageSize: 10
  };
  const assetsQuery = useQuery({
    queryKey: queryKeys.mediaAssets(query),
    queryFn: () => apiClient.getMediaAssets(query),
    enabled: open && Boolean(projectId) && !atFavoriteRoot
  });
  const foldersQuery = useQuery({
    queryKey: queryKeys.assetFolders,
    queryFn: () => apiClient.getAssetFolders(),
    enabled: open
  });

  useEffect(() => {
    if (!open) return;
    setScope("all");
    setFolderId(null);
    setSearchInput("");
    setKeyword("");
    setSource("all");
    setPage(1);
    setSelected(new Map());
    setNotice("");
  }, [open]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setKeyword(searchInput.trim());
    setPage(1);
  };

  const changeScope = (nextScope: PickerScope) => {
    setScope(nextScope);
    setFolderId(null);
    setPage(1);
    setKeyword("");
    setSearchInput("");
    setNotice("");
  };

  const toggleAsset = (asset: MediaAssetListItem) => {
    setNotice("");
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(asset.id)) {
        next.delete(asset.id);
        return next;
      }
      if (next.size >= maxSelection) {
        setNotice("已达到本次可添加上限。");
        return current;
      }
      next.set(asset.id, asset);
      return next;
    });
  };

  const currentFolder = foldersQuery.data?.items.find((folder) => folder.id === folderId);
  const visibleFolders = (foldersQuery.data?.items ?? []).filter(
    (folder) => !keyword || folder.name.toLocaleLowerCase().includes(keyword.toLocaleLowerCase())
  );
  const pagination = assetsQuery.data?.pagination;
  const remainingSelection = remainingAssetSelectionCapacity(maxSelection, selected.size);
  const selectionLimitReached = remainingSelection === 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.dialog}>
          <header className={styles.header}>
            <Dialog.Title>从资产库选择</Dialog.Title>
            <Dialog.Close aria-label="关闭资产选择器">
              <X />
            </Dialog.Close>
          </header>

          <div className={styles.tabs} role="tablist" aria-label="资产范围">
            <button
              type="button"
              role="tab"
              aria-selected={scope === "all"}
              onClick={() => changeScope("all")}
            >
              全部素材
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === "favorites"}
              onClick={() => changeScope("favorites")}
            >
              我的收藏
            </button>
          </div>

          <div className={styles.toolbar}>
            {!atFavoriteRoot && (
              <label className={styles.sourceFilter}>
                <span>来源</span>
                <select
                  value={source}
                  onChange={(event) => {
                    setSource(event.target.value as PickerSource);
                    setPage(1);
                  }}
                >
                  <option value="all">全部来源</option>
                  <option value="generated">AI 生成</option>
                  <option value="uploaded">本地上传</option>
                </select>
              </label>
            )}
            <form onSubmit={submitSearch}>
              <label>
                <Search />
                <input
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder={atFavoriteRoot ? "搜索文件夹" : "搜索图片名称、关键词"}
                />
              </label>
              <Button type="submit" variant="secondary">
                搜索
              </Button>
            </form>
          </div>

          <div className={styles.path} data-empty={!folderId || undefined}>
            {folderId && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setFolderId(null);
                    setPage(1);
                  }}
                  aria-label="返回收藏文件夹"
                >
                  <ArrowLeft />
                </button>
                <span>我的收藏</span>
                <span>/</span>
                <strong>{currentFolder?.name}</strong>
              </>
            )}
          </div>

          <div className={styles.content}>
            {atFavoriteRoot ? (
              foldersQuery.isPending ? (
                <PickerSkeletons />
              ) : visibleFolders.length === 0 ? (
                <PickerEmpty text="没有找到收藏文件夹" />
              ) : (
                <div className={styles.folderGrid}>
                  {visibleFolders.map((folder) => (
                    <button
                      type="button"
                      key={folder.id}
                      onClick={() => {
                        setFolderId(folder.id);
                        setPage(1);
                      }}
                    >
                      <Folder />
                      <span>
                        <strong>{folder.name}</strong>
                        <small>{folder.assetCount} 个素材</small>
                      </span>
                      <ChevronRight />
                    </button>
                  ))}
                </div>
              )
            ) : assetsQuery.isPending ? (
              <PickerSkeletons />
            ) : assetsQuery.isError ? (
              <PickerEmpty text="资产读取失败，请稍后重试" />
            ) : assetsQuery.data.items.length === 0 ? (
              <PickerEmpty text="没有找到符合条件的图片" />
            ) : (
              <>
                <div className={styles.resultSummary}>共 {pagination?.total ?? 0} 个图片素材</div>
                <div className={styles.grid}>
                  {assetsQuery.data.items.map((asset) => {
                    const isExcluded = excludedAssetIds.has(asset.id);
                    const isSelected = selected.has(asset.id);
                    return (
                      <button
                        className={styles.assetCard}
                        type="button"
                        key={asset.id}
                        data-selected={isSelected || undefined}
                        disabled={isExcluded || (!isSelected && selectionLimitReached)}
                        onClick={() => toggleAsset(asset)}
                        aria-pressed={isSelected}
                      >
                        <span className={styles.check}>{isSelected ? <Check /> : null}</span>
                        <span className={styles.preview}>
                          <AssetThumbnail
                            src={apiClient.mediaContentUrl(asset.id)}
                            alt={asset.name}
                            sizes="(max-width: 700px) 100vw, (max-width: 1000px) 50vw, 25vw"
                          />
                        </span>
                        <span className={styles.assetInfo}>
                          <strong title={asset.name}>{asset.name}</strong>
                          <small>
                            {isExcluded
                              ? "已在当前创作中"
                              : asset.source === "generated"
                                ? "AI 生成"
                                : "本地上传"}
                          </small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className={styles.pagination}>
            {!atFavoriteRoot && pagination && pagination.totalPages > 1 && (
              <>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  aria-label="上一页"
                >
                  <ChevronLeft />
                </button>
                <span>
                  {page} / {pagination.totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage((value) => value + 1)}
                  aria-label="下一页"
                >
                  <ChevronRight />
                </button>
              </>
            )}
          </div>

          <footer className={styles.footer}>
            <div>
              <strong>已选择 {selected.size} 张</strong>
              <span>
                {notice ||
                  (selectionLimitReached
                    ? "已达到本次可添加上限"
                    : `当前还可添加 ${remainingSelection} 张`)}
              </span>
            </div>
            <div>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                type="button"
                disabled={selected.size === 0}
                onClick={() => {
                  onConfirm([...selected.values()]);
                  onOpenChange(false);
                }}
              >
                确认添加
              </Button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PickerSkeletons() {
  return (
    <div className={styles.grid} aria-label="正在加载素材">
      {Array.from({ length: 8 }, (_, index) => (
        <div className={styles.skeleton} key={index} />
      ))}
    </div>
  );
}

function PickerEmpty({ text }: Readonly<{ text: string }>) {
  return (
    <div className={styles.empty}>
      <Images />
      <span>{text}</span>
    </div>
  );
}
