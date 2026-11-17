export type OutputFormat = 'png' | 'jpg';
export type ExtractionMode = 'single' | 'batch';
export type BatchRule = 'seconds' | 'fps';

export interface ExtractedFrame {
  id: string;
  index: number;
  timestamp: number;
  width: number;
  height: number;
  format: OutputFormat;
  blob: Blob;
  objectUrl: string;
  filename: string;
}

const ACCEPTED_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'webm',
  'mov',
  'avi',
  'mkv',
  'ogv',
]);

export function isSupportedVideoFile(file: File): boolean {
  if (file.type && file.type.startsWith('video/')) {
    return true;
  }
  const dotIdx = file.name.lastIndexOf('.');
  if (dotIdx === -1) return false;
  const ext = file.name.slice(dotIdx + 1).toLowerCase();
  return ACCEPTED_EXTENSIONS.has(ext);
}

export function sanitizeBaseName(filename: string): string {
  const dotIdx = filename.lastIndexOf('.');
  const raw = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const clean = raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || 'video';
}

export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.000';
  const totalMs = Math.round(seconds * 1000);
  const hrs = Math.floor(totalMs / 3600000);
  const mins = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;

  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const mmm = String(ms).padStart(3, '0');

  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${mm}:${ss}.${mmm}`;
  }
  return `${mm}:${ss}.${mmm}`;
}

export function formatTimestampForFilename(seconds: number): string {
  return formatTimestamp(seconds).replace(/[:.]/g, '-');
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function computeBatchTimestamps(
  startSec: number,
  endSec: number,
  rule: BatchRule,
  value: number,
  duration: number
): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  if (!Number.isFinite(value) || value <= 0) return [];

  const safeStart = Math.max(0, Math.min(startSec, duration));
  const safeEnd = Math.max(0, Math.min(endSec, duration));
  if (safeStart >= safeEnd && Math.abs(safeEnd - safeStart) > 0.001) return [];

  const step = rule === 'seconds' ? value : 1 / value;
  if (!Number.isFinite(step) || step <= 0) return [];

  const maxTimestamps = 5000;
  const timestamps: number[] = [];
  const maxSafeTime = Math.max(0, duration - 0.002);

  for (let i = 0; i < maxTimestamps; i++) {
    const raw = safeStart + i * step;
    if (raw > safeEnd + 0.0005) break;
    const clamped = Math.min(raw, safeEnd, maxSafeTime);
    if (
      timestamps.length === 0 ||
      Math.abs(clamped - timestamps[timestamps.length - 1]) >= 0.001
    ) {
      timestamps.push(Number(clamped.toFixed(4)));
    }
  }

  return timestamps;
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function captureVideoFrameToBlob(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  format: OutputFormat,
  jpgQuality: number
): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    throw new Error('Video dimensions are unavailable.');
  }

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not acquire 2D canvas context.');
  }

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(video, 0, 0, width, height);

  const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
  const quality = format === 'jpg' ? Math.max(0.5, Math.min(1, jpgQuality / 100)) : undefined;

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to encode frame image.'));
        }
      },
      mimeType,
      quality
    );
  });
}

export function buildFrameFilename(
  videoBaseName: string,
  index: number,
  timestamp: number,
  format: OutputFormat
): string {
  const seq = String(index).padStart(4, '0');
  const tsSlug = formatTimestampForFilename(timestamp);
  return `${videoBaseName}_frame-${seq}_${tsSlug}.${format}`;
}

export async function seekVideo(
  video: HTMLVideoElement,
  targetTime: number,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const maxSeek = duration > 0.005 ? duration - 0.002 : duration;
  const clamped = Math.max(0, Math.min(targetTime, maxSeek));

  if (Math.abs(video.currentTime - clamped) < 0.0005 && video.readyState >= 2) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      window.clearTimeout(timerId);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onSeeked = () => {
      if (video.readyState >= 2) {
        finish();
      } else {
        const onCanPlay = () => {
          video.removeEventListener('canplay', onCanPlay);
          finish();
        };
        video.addEventListener('canplay', onCanPlay, { once: true });
      }
    };

    const onError = () => fail(new Error('Video seek failed.'));
    const onAbort = () => fail(new DOMException('Aborted', 'AbortError'));

    const timerId = window.setTimeout(() => {
      fail(new Error('Video seek timed out.'));
    }, 8000);

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });

    video.currentTime = clamped;
  });
}

export function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

export async function createFramesZipBlob(frames: ExtractedFrame[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const usedNames = new Set<string>();

  for (const frame of frames) {
    let entryName = frame.filename;
    if (usedNames.has(entryName)) {
      const dotIdx = entryName.lastIndexOf('.');
      const stem = entryName.slice(0, dotIdx);
      const ext = entryName.slice(dotIdx);
      let counter = 2;
      while (usedNames.has(`${stem}_${counter}${ext}`)) {
        counter++;
      }
      entryName = `${stem}_${counter}${ext}`;
    }
    usedNames.add(entryName);
    zip.file(entryName, frame.blob, { compression: 'STORE' });
  }

  return zip.generateAsync({
    type: 'blob',
    compression: 'STORE',
  });
}
