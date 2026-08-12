import Image from "next/image";

import styles from "./asset-thumbnail.module.css";

export function AssetThumbnail({
  src,
  alt,
  sizes,
  onError
}: Readonly<{
  src: string;
  alt: string;
  sizes: string;
  onError?: () => void;
}>) {
  return (
    <Image
      className={styles.foreground}
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      unoptimized
      onError={onError}
    />
  );
}
