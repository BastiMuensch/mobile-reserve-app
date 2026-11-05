"use client";

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

/** New signatures are private until the profile is saved, so preview the selected file locally. */
export function SignaturePreview({ source, file }: { source: string; file?: File | null }) {
  const [localPreview, setLocalPreview] = useState<{ file: File; url: string } | null>(null);
  const [localError, setLocalError] = useState<File | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const releasePreview = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!file) return;
    let url: string;
    try {
      url = URL.createObjectURL(file);
      setLocalPreview({ file, url });
      setLocalError(null);
    } catch {
      setLocalError(file);
      return;
    }
    let released = false;
    const release = () => {
      if (!released) URL.revokeObjectURL(url);
      released = true;
    };
    releasePreview.current = release;
    // Covers replacement, removal, successful saving and leaving the page.
    return () => {
      release();
      if (releasePreview.current === release) releasePreview.current = null;
    };
  }, [file]);

  const previewSource = file ? localPreview?.file === file ? localPreview.url : null : source;
  if ((file && localError === file) || (previewSource && failedSource === previewSource)) {
    return <p role="alert" className="text-sm text-destructive">Die Unterschrift kann nicht angezeigt werden. Bitte wählen Sie eine gültige PNG- oder JPEG-Datei erneut aus.</p>;
  }
  if (!previewSource) return <p role="status" className="text-sm text-muted-foreground">Unterschriftsvorschau wird geladen …</p>;

  return <Image src={previewSource} alt="Unterschrift Vorschau" width={200} height={200}
    className="max-h-[80px] w-auto max-w-full rounded object-contain" unoptimized
    onError={() => {
      if (file) releasePreview.current?.();
      setFailedSource(previewSource);
    }} />;
}
