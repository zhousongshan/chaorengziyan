type ClipboardItemLike = {
  kind: string;
  type: string;
  getAsFile: () => File | null;
};

type ClipboardDataLike = {
  items: ArrayLike<ClipboardItemLike>;
  files?: ArrayLike<File>;
};

export function extractClipboardImageFiles(clipboardData: ClipboardDataLike) {
  const files: File[] = [];
  for (let index = 0; index < clipboardData.items.length; index += 1) {
    const item = clipboardData.items[index];
    if (!item || item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (files.length === 0 && clipboardData.files) {
    for (let index = 0; index < clipboardData.files.length; index += 1) {
      const file = clipboardData.files[index];
      if (file?.type.startsWith("image/")) files.push(file);
    }
  }
  return files;
}
