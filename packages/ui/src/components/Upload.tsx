'use client';

import { useRef, useState } from 'react';
import { Button } from './Button';

export interface UploadResult {
  id: string;
  url: string | null;
  originalName: string;
}

export interface UploadProps {
  accept: string;
  maxBytes: number;
  purpose: string;
  labels: {
    chooseFile: string;
    hint: string;
    uploading: string;
    tooLarge: string;
    failed: string;
    result: string;
  };
  /** Performs the authenticated upload; the API re-validates everything. */
  onUpload: (file: File, purpose: string) => Promise<UploadResult>;
  onUploaded?: (result: UploadResult) => void;
}

export function Upload({ accept, maxBytes, purpose, labels, onUpload, onUploaded }: UploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setResult(null);
    if (file.size > maxBytes) {
      setError(labels.tooLarge);
      return;
    }
    setBusy(true);
    setProgress(10);
    try {
      const uploaded = await onUpload(file, purpose);
      setProgress(100);
      setResult(uploaded);
      onUploaded?.(uploaded);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : labels.failed);
      setProgress(0);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="upload">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        aria-label={labels.chooseFile}
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <span className="field-help">{labels.hint}</span>
      {busy ? (
        <>
          <div className="upload-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <span className="field-help">{labels.uploading}</span>
        </>
      ) : null}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
      {result ? (
        <div className="row">
          <span className="field-help">
            {labels.result}: {result.originalName}
          </span>
          <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>
            {labels.chooseFile}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
