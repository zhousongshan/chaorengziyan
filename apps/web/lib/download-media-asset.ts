const imageExtensionByMimeType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export async function downloadMediaAsset(input: { url: string; name: string; mimeType: string }) {
  const response = await fetch(input.url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("MEDIA_ASSET_DOWNLOAD_FAILED");

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = mediaDownloadFileName(input.name, blob.type || input.mimeType);
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export function mediaDownloadFileName(name: string, mimeType: string) {
  const safeName =
    [...name.trim().replace(/[\\/:*?"<>|]/g, "_")]
      .map((character) => (character.charCodeAt(0) < 32 ? "_" : character))
      .join("") || "图片";
  if (/\.(?:png|jpe?g|webp)$/i.test(safeName)) return safeName;

  const extension = imageExtensionByMimeType[mimeType.toLowerCase()] ?? "png";
  return `${safeName}.${extension}`;
}
