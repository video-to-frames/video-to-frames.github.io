import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  DEFAULT_LOCALE,
  ensureLocale,
  getClientLocale,
  LANG_EVENT,
  t,
  type LocaleCode,
  type TranslationKey,
} from '../i18n';
import {
  buildFrameFilename,
  captureVideoFrameToBlob,
  computeBatchTimestamps,
  createFramesZipBlob,
  formatBytes,
  formatTimestamp,
  isSupportedVideoFile,
  sanitizeBaseName,
  seekVideo,
  triggerBlobDownload,
  yieldToMainThread,
  type BatchRule,
  type ExtractedFrame,
  type ExtractionMode,
  type OutputFormat,
} from '../lib/frame-extractor';

interface LoadedVideoMeta {
  name: string;
  baseName: string;
  size: number;
  duration: number;
  width: number;
  height: number;
}

const FRAME_STEP_SEC = 1 / 30;
const SECONDS_PRESETS = [0.5, 1, 2, 5, 10];
const FPS_PRESETS = [1, 2, 5, 10, 24, 30];

interface FrameExtractorProps {
  initialLocale?: LocaleCode;
}

export default function FrameExtractor({ initialLocale = DEFAULT_LOCALE }: FrameExtractorProps) {
  const [locale, setLocale] = useState<LocaleCode>(initialLocale);
  const tr = useCallback((key: TranslationKey) => t(locale, key), [locale]);

  useEffect(() => {
    const target = getClientLocale();
    if (target !== initialLocale) {
      ensureLocale(target).then(() => setLocale(target));
    }
    const onLangChange = (ev: Event) => {
      const custom = ev as CustomEvent<LocaleCode>;
      if (custom.detail) setLocale(custom.detail);
    };
    window.addEventListener(LANG_EVENT, onLangChange);
    return () => window.removeEventListener(LANG_EVENT, onLangChange);
  }, [initialLocale]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const framesRef = useRef<ExtractedFrame[]>([]);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const lightboxCloseRef = useRef<HTMLButtonElement>(null);
  const lastLightboxTriggerRef = useRef<HTMLElement | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMeta, setVideoMeta] = useState<LoadedVideoMeta | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [liveMsg, setLiveMsg] = useState<string>('');

  const [mode, setMode] = useState<ExtractionMode>('single');
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('png');
  const [jpgQuality, setJpgQuality] = useState<number>(92);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [jumpValue, setJumpValue] = useState('0.00');
  const [shutterCount, setShutterCount] = useState(0);

  // Batch extraction state
  const [batchRule, setBatchRule] = useState<BatchRule>('seconds');
  const [secondsInterval, setSecondsInterval] = useState<number>(1);
  const [fpsValue, setFpsValue] = useState<number>(2);
  const [trimStart, setTrimStart] = useState<number>(0);
  const [trimEnd, setTrimEnd] = useState<number>(0);
  const [isExtracting, setIsExtracting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  // Gallery & ZIP state
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [isZipping, setIsZipping] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  useEffect(() => {
    framesRef.current = frames;
  }, [frames]);

  const revokeAllFrames = useCallback((list: ExtractedFrame[]) => {
    for (const f of list) {
      URL.revokeObjectURL(f.objectUrl);
    }
  }, []);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
      revokeAllFrames(framesRef.current);
    };
  }, [revokeAllFrames]);

  const clearGallery = useCallback(() => {
    revokeAllFrames(framesRef.current);
    setFrames([]);
    setLightboxIdx(null);
  }, [revokeAllFrames]);

  const resetAll = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsExtracting(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setJumpValue('0.00');
    setErrorMsg(null);
    setStatusNote(null);
    setVideoMeta(null);
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }
    setVideoUrl(null);
    clearGallery();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [clearGallery]);

  const loadFile = useCallback(
    (file: File) => {
      setErrorMsg(null);
      setStatusNote(null);

      if (!isSupportedVideoFile(file)) {
        setErrorMsg(tr('tool.errorNotVideo'));
        return;
      }

      abortControllerRef.current?.abort();
      setIsExtracting(false);
      setIsPlaying(false);
      clearGallery();

      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current);
      }

      const nextUrl = URL.createObjectURL(file);
      videoUrlRef.current = nextUrl;
      setVideoUrl(nextUrl);
      setVideoMeta({
        name: file.name,
        baseName: sanitizeBaseName(file.name),
        size: file.size,
        duration: 0,
        width: 0,
        height: 0,
      });
    },
    [clearGallery, tr]
  );

  const onFileInputChange = (ev: Event) => {
    const input = ev.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) loadFile(file);
  };

  const onDrop = (ev: DragEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    setIsDragging(false);
    const file = ev.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  };

  const onDragOver = (ev: DragEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const onDragLeave = (ev: DragEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    setIsDragging(false);
  };

  const syncVideoDimensions = () => {
    const video = videoRef.current;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const width = video.videoWidth;
    const height = video.videoHeight;

    setVideoMeta((prev) =>
      prev
        ? {
            ...prev,
            duration: duration || prev.duration,
            width: width || prev.width,
            height: height || prev.height,
          }
        : null
    );

    if (duration > 0) {
      setTrimStart((s) => (s > duration ? 0 : s));
      setTrimEnd((e) => (e === 0 || e > duration ? Number(duration.toFixed(2)) : e));
    }
  };

  const onVideoLoadedMetadata = () => {
    syncVideoDimensions();
    setCurrentTime(0);
    setJumpValue('0.00');
    setTrimStart(0);
    const video = videoRef.current;
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      setTrimEnd(Number(video.duration.toFixed(2)));
    }
    setErrorMsg(null);
    setLiveMsg(tr('tool.liveVideoLoaded'));
  };

  const onVideoLoadedData = () => {
    syncVideoDimensions();
    const video = videoRef.current;
    if (video && (video.videoWidth === 0 || video.videoHeight === 0)) {
      setErrorMsg(tr('tool.errorUnsupported'));
    }
  };

  const onVideoError = () => {
    setErrorMsg(tr('tool.errorUnsupported'));
    setIsPlaying(false);
    setIsExtracting(false);
  };

  const seekTo = useCallback(
    (timeSec: number) => {
      const video = videoRef.current;
      if (!video || !videoMeta?.duration) return;
      const clamped = Math.max(0, Math.min(timeSec, Math.max(0, videoMeta.duration - 0.001)));
      video.currentTime = clamped;
      setCurrentTime(clamped);
      setJumpValue(clamped.toFixed(2));
    },
    [videoMeta]
  );

  const togglePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video || isExtracting) return;
    if (video.paused) {
      try {
        await video.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, [isExtracting]);

  const stepTime = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video || isExtracting) return;
      if (!video.paused) {
        video.pause();
        setIsPlaying(false);
      }
      seekTo((video.currentTime || 0) + delta);
    },
    [isExtracting, seekTo]
  );

  const captureCurrentFrame = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !videoMeta || video.videoWidth === 0 || isExtracting) return;

    if (!video.paused) {
      video.pause();
      setIsPlaying(false);
    }

    try {
      setErrorMsg(null);
      setStatusNote(null);
      const ts = video.currentTime || 0;
      const blob = await captureVideoFrameToBlob(video, canvas, outputFormat, jpgQuality);
      const objectUrl = URL.createObjectURL(blob);

      setShutterCount((c) => c + 1);
      setFrames((prev) => {
        const nextIndex = prev.length + 1;
        const filename = buildFrameFilename(videoMeta.baseName, nextIndex, ts, outputFormat);
        const item: ExtractedFrame = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          index: nextIndex,
          timestamp: ts,
          width: video.videoWidth,
          height: video.videoHeight,
          format: outputFormat,
          blob,
          objectUrl,
          filename,
        };
        setLiveMsg(`${tr('tool.capturedFlash')} #${nextIndex}`);
        return [...prev, item];
      });
    } catch {
      setErrorMsg(tr('tool.errorUnsupported'));
    }
  }, [isExtracting, jpgQuality, outputFormat, tr, videoMeta]);

  const activeBatchValue = batchRule === 'seconds' ? secondsInterval : fpsValue;

  const estimatedBatchTimestamps = useMemo(() => {
    if (!videoMeta?.duration) return [];
    return computeBatchTimestamps(
      trimStart,
      trimEnd,
      batchRule,
      activeBatchValue,
      videoMeta.duration
    );
  }, [activeBatchValue, batchRule, trimEnd, trimStart, videoMeta]);

  const runBatchExtraction = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !videoMeta || !videoMeta.duration || isExtracting) return;

    setErrorMsg(null);
    setStatusNote(null);

    if (trimStart >= trimEnd && videoMeta.duration > 0.05) {
      setErrorMsg(tr('tool.errorInvalidRange'));
      return;
    }

    const timestamps = computeBatchTimestamps(
      trimStart,
      trimEnd,
      batchRule,
      activeBatchValue,
      videoMeta.duration
    );

    if (timestamps.length === 0) {
      setErrorMsg(tr('tool.errorNoFrames'));
      return;
    }

    if (!video.paused) {
      video.pause();
      setIsPlaying(false);
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsExtracting(true);
    setProgress({ current: 0, total: timestamps.length });
    setLiveMsg(`${tr('tool.liveBatchStart')} (${timestamps.length} ${tr('tool.framesUnit')})`);

    let startingIdx = framesRef.current.length;

    try {
      for (let i = 0; i < timestamps.length; i++) {
        if (controller.signal.aborted) break;
        const ts = timestamps[i];

        await seekVideo(video, ts, controller.signal);
        if (controller.signal.aborted) break;

        const blob = await captureVideoFrameToBlob(video, canvas, outputFormat, jpgQuality);
        const objectUrl = URL.createObjectURL(blob);

        startingIdx += 1;
        const filename = buildFrameFilename(videoMeta.baseName, startingIdx, ts, outputFormat);

        const nextFrame: ExtractedFrame = {
          id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
          index: startingIdx,
          timestamp: ts,
          width: video.videoWidth,
          height: video.videoHeight,
          format: outputFormat,
          blob,
          objectUrl,
          filename,
        };

        setFrames((prev) => [...prev, nextFrame]);
        setCurrentTime(ts);
        setJumpValue(ts.toFixed(2));
        setProgress({ current: i + 1, total: timestamps.length });
        if ((i + 1) % 10 === 0 || i === timestamps.length - 1) {
          setLiveMsg(`${tr('tool.extractingProgress')} ${i + 1} ${tr('tool.of')} ${timestamps.length}`);
        }

        await yieldToMainThread();
      }
      if (!controller.signal.aborted) {
        setLiveMsg(tr('tool.liveBatchComplete'));
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatusNote(tr('tool.cancelledNote'));
      } else {
        setErrorMsg(tr('tool.errorUnsupported'));
      }
    } finally {
      setIsExtracting(false);
      abortControllerRef.current = null;
    }
  };

  const cancelBatchExtraction = () => {
    abortControllerRef.current?.abort();
  };

  const removeFrame = (id: string) => {
    setFrames((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) URL.revokeObjectURL(target.objectUrl);
      return prev.filter((f) => f.id !== id);
    });
    setLightboxIdx(null);
  };

  const closeLightbox = useCallback(() => {
    setLightboxIdx(null);
    window.requestAnimationFrame(() => {
      lastLightboxTriggerRef.current?.focus();
      lastLightboxTriggerRef.current = null;
    });
  }, []);

  const handleDownloadZip = async () => {
    if (frames.length === 0 || isZipping || !videoMeta) return;
    setIsZipping(true);
    setLiveMsg(tr('tool.liveZipStart'));
    try {
      const zipBlob = await createFramesZipBlob(frames);
      triggerBlobDownload(zipBlob, `${videoMeta.baseName}-frames.zip`);
      setLiveMsg(tr('tool.liveZipComplete'));
    } finally {
      setIsZipping(false);
    }
  };

  useEffect(() => {
    if (lightboxIdx !== null) {
      lightboxCloseRef.current?.focus();
    }
  }, [lightboxIdx !== null]);

  // Keyboard shortcuts when video is loaded (ignored inside form inputs)
  useEffect(() => {
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (!videoUrl || !videoMeta?.duration) return;

      if (lightboxIdx !== null) {
        if (ev.key === 'Escape') {
          closeLightbox();
        } else if (ev.key === 'ArrowLeft') {
          ev.preventDefault();
          setLightboxIdx((i) => (i !== null && i > 0 ? i - 1 : i));
        } else if (ev.key === 'ArrowRight') {
          ev.preventDefault();
          setLightboxIdx((i) => (i !== null && i < frames.length - 1 ? i + 1 : i));
        } else if (ev.key === 'Tab' && lightboxRef.current) {
          const focusables = Array.from(
            lightboxRef.current.querySelectorAll<HTMLElement>(
              'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
            )
          );
          if (focusables.length > 0) {
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (ev.shiftKey && document.activeElement === first) {
              ev.preventDefault();
              last.focus();
            } else if (!ev.shiftKey && document.activeElement === last) {
              ev.preventDefault();
              first.focus();
            }
          }
        }
        return;
      }

      const target = ev.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }

      if (mode !== 'single' || isExtracting) return;

      if (ev.code === 'Space') {
        ev.preventDefault();
        togglePlay();
      } else if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        stepTime(ev.shiftKey ? -1 : -FRAME_STEP_SEC);
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        stepTime(ev.shiftKey ? 1 : FRAME_STEP_SEC);
      } else if (ev.key === 'c' || ev.key === 'C') {
        ev.preventDefault();
        captureCurrentFrame();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    captureCurrentFrame,
    frames.length,
    isExtracting,
    lightboxIdx,
    mode,
    stepTime,
    togglePlay,
    videoMeta,
    videoUrl,
  ]);

  const activeLightboxFrame = lightboxIdx !== null ? frames[lightboxIdx] ?? null : null;
  const progressPct =
    progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0;

  return (
    <div
      class="tool-workspace-card"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,.mp4,.webm,.mov,.avi,.mkv,.m4v,.ogv"
        class="sr-only"
        aria-label={tr('tool.selectVideoBtn')}
        onChange={onFileInputChange}
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} aria-hidden="true" />
      <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveMsg}
      </div>

      {/* Top Privacy Badge + Video Info Bar */}
      <div class="workspace-topbar">
        <div class="privacy-badge" role="status">
          <span class="privacy-dot" aria-hidden="true" />
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
            <rect x="4" y="11" width="16" height="10" rx="2.5" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <span>{tr('tool.privacyBadge')}</span>
        </div>

        {videoMeta && (
          <div class="video-meta-strip">
            {videoMeta.width > 0 && (
              <span class="meta-chip mono-num">
                {tr('tool.resolutionLabel')}: <strong>{videoMeta.width}×{videoMeta.height}</strong>
              </span>
            )}
            {videoMeta.duration > 0 && (
              <span class="meta-chip mono-num">
                {tr('tool.durationLabel')}: <strong>{formatTimestamp(videoMeta.duration)}</strong>
              </span>
            )}
            <span class="meta-chip mono-num">
              {tr('tool.sizeLabel')}: <strong>{formatBytes(videoMeta.size)}</strong>
            </span>
            <button
              type="button"
              class="btn-secondary btn-sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isExtracting}
            >
              {tr('tool.changeVideoBtn')}
            </button>
            <button
              type="button"
              class="btn-ghost btn-sm"
              onClick={resetAll}
            >
              {tr('tool.clearVideoBtn')}
            </button>
          </div>
        )}
      </div>

      {errorMsg && (
        <div class="alert-banner alert-error" role="alert">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v5" />
            <circle cx="12" cy="16.5" r="0.8" fill="currentColor" />
          </svg>
          <span>{errorMsg}</span>
        </div>
      )}

      {statusNote && (
        <div class="alert-banner alert-warning" role="status">
          <span>{statusNote}</span>
        </div>
      )}

      {/* Initial Empty Dropzone */}
      {!videoUrl && (
        <div
          class={`drop-zone ${isDragging ? 'is-dragging' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={tr('tool.selectVideoBtn')}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <div class="drop-icon-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="3" />
              <path d="M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5" />
              <path d="M12 15V9m0 0-2.5 2.5M12 9l2.5 2.5" />
            </svg>
          </div>

          <h2 class="drop-title">
            {isDragging ? tr('tool.dropActive') : tr('tool.dropTitle')}
          </h2>
          <p class="drop-subtitle">{tr('tool.dropSubtitle')}</p>

          <span class="btn-primary btn-lg">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
              <path d="M12 16V4m0 0-4 4m4-4 4 4" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke-linecap="round" />
            </svg>
            {tr('tool.selectVideoBtn')}
          </span>

          <div class="format-pills" aria-label={tr('tool.supportedFormatsLabel')}>
            {['MP4', 'WebM', 'MOV', 'AVI', 'MKV'].map((fmt) => (
              <span class="format-pill" key={fmt}>
                {fmt}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Loaded Video Player + Controls */}
      {videoUrl && (
        <>
          <h2 class="sr-only">{tr('tool.workspaceHeading')}</h2>
          <div class="workspace-grid">
            <div class="player-panel">
              <div class="video-stage">
                <video
                  ref={videoRef}
                  src={videoUrl}
                  muted
                  playsInline
                  preload="auto"
                  onLoadedMetadata={onVideoLoadedMetadata}
                  onLoadedData={onVideoLoadedData}
                  onTimeUpdate={() => {
                    const v = videoRef.current;
                    if (v && !isExtracting) {
                      setCurrentTime(v.currentTime);
                      setJumpValue(v.currentTime.toFixed(2));
                    }
                  }}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  onError={onVideoError}
                />
                {shutterCount > 0 && <div key={shutterCount} class="shutter-flash" />}
                {shutterCount > 0 && (
                  <div key={`toast-${shutterCount}`} class="capture-toast-pill" role="status">
                    {tr('tool.capturedFlash')}
                  </div>
                )}
              </div>

              <div class="scrubber-wrap">
                <div class="scrubber-header mono-num">
                  <span>{formatTimestamp(currentTime)}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {formatTimestamp(videoMeta?.duration ?? 0)}
                  </span>
                </div>
                <input
                  type="range"
                  class="range-slider"
                  aria-label={tr('tool.scrubberAria')}
                  min={0}
                  max={videoMeta?.duration || 1}
                  step={0.001}
                  value={currentTime}
                  disabled={!videoMeta?.duration || isExtracting}
                  onInput={(ev) => {
                    const val = parseFloat((ev.currentTarget as HTMLInputElement).value);
                    const v = videoRef.current;
                    if (v && !v.paused) {
                      v.pause();
                      setIsPlaying(false);
                    }
                    seekTo(val);
                  }}
                />
              </div>

            <div class="transport-bar">
              <button
                type="button"
                class="btn-secondary"
                onClick={() => stepTime(-1)}
                disabled={!videoMeta?.duration || isExtracting}
              >
                {tr('tool.stepBack1s')}
              </button>
              <button
                type="button"
                class="btn-secondary"
                onClick={() => stepTime(-FRAME_STEP_SEC)}
                disabled={!videoMeta?.duration || isExtracting}
              >
                {tr('tool.stepBackFrame')}
              </button>
              <button
                type="button"
                class="btn-primary"
                onClick={togglePlay}
                disabled={!videoMeta?.duration || isExtracting}
              >
                {isPlaying ? tr('tool.pause') : tr('tool.play')}
              </button>
              <button
                type="button"
                class="btn-secondary"
                onClick={() => stepTime(FRAME_STEP_SEC)}
                disabled={!videoMeta?.duration || isExtracting}
              >
                {tr('tool.stepForwardFrame')}
              </button>
              <button
                type="button"
                class="btn-secondary"
                onClick={() => stepTime(1)}
                disabled={!videoMeta?.duration || isExtracting}
              >
                {tr('tool.stepForward1s')}
              </button>
            </div>

            <div class="jump-row">
              <label htmlFor="vtf-jump-input">{tr('tool.jumpToLabel')}</label>
              <input
                id="vtf-jump-input"
                type="number"
                class="field-input mono-num"
                min={0}
                max={videoMeta?.duration || 0}
                step={0.01}
                value={jumpValue}
                disabled={!videoMeta?.duration || isExtracting}
                onInput={(ev) => {
                  const raw = (ev.currentTarget as HTMLInputElement).value;
                  setJumpValue(raw);
                  const num = parseFloat(raw);
                  if (Number.isFinite(num)) {
                    seekTo(num);
                  }
                }}
              />
            </div>
          </div>

          <div class="controls-panel">
            {/* Mode Switcher */}
            <div>
              <span class="control-group-label">{tr('tool.modeLabel')}</span>
              <div
                class="segmented"
                role="tablist"
                aria-label={tr('tool.modeLabel')}
                onKeyDown={(ev) => {
                  if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
                    ev.preventDefault();
                    setMode((m) => (m === 'single' ? 'batch' : 'single'));
                  }
                }}
              >
                <button
                  id="vtf-tab-single"
                  type="button"
                  role="tab"
                  aria-selected={mode === 'single'}
                  aria-controls="vtf-panel-single"
                  class={`segment-btn ${mode === 'single' ? 'is-active' : ''}`}
                  onClick={() => setMode('single')}
                  disabled={isExtracting}
                >
                  {tr('tool.modeSingle')}
                </button>
                <button
                  id="vtf-tab-batch"
                  type="button"
                  role="tab"
                  aria-selected={mode === 'batch'}
                  aria-controls="vtf-panel-batch"
                  class={`segment-btn ${mode === 'batch' ? 'is-active' : ''}`}
                  onClick={() => setMode('batch')}
                  disabled={isExtracting}
                >
                  {tr('tool.modeBatch')}
                </button>
              </div>
            </div>

            {/* Output Format Switcher */}
            <div>
              <span class="control-group-label">{tr('tool.formatLabel')}</span>
              <div class="segmented" role="radiogroup" aria-label={tr('tool.formatLabel')}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={outputFormat === 'png'}
                  class={`segment-btn ${outputFormat === 'png' ? 'is-active' : ''}`}
                  onClick={() => setOutputFormat('png')}
                  disabled={isExtracting}
                >
                  <span>PNG</span>
                  <span class="format-sub">({tr('tool.formatPngDesc')})</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={outputFormat === 'jpg'}
                  class={`segment-btn ${outputFormat === 'jpg' ? 'is-active' : ''}`}
                  onClick={() => setOutputFormat('jpg')}
                  disabled={isExtracting}
                >
                  <span>JPG</span>
                  <span class="format-sub">({tr('tool.formatJpgDesc')})</span>
                </button>
              </div>

              {outputFormat === 'jpg' && (
                <div style={{ marginTop: '0.75rem' }}>
                  <div class="scrubber-header" style={{ marginBottom: '0.3rem' }}>
                    <span style={{ fontSize: '0.86rem' }}>{tr('tool.jpgQuality')}</span>
                    <span class="mono-num">{jpgQuality}%</span>
                  </div>
                  <input
                    type="range"
                    class="range-slider"
                    aria-label={tr('tool.jpgQuality')}
                    min={50}
                    max={100}
                    step={1}
                    value={jpgQuality}
                    disabled={isExtracting}
                    onInput={(ev) =>
                      setJpgQuality(parseInt((ev.currentTarget as HTMLInputElement).value, 10))
                    }
                  />
                </div>
              )}
            </div>

            {/* Mode 1 Controls: Single Frame */}
            {mode === 'single' && (
              <div
                id="vtf-panel-single"
                role="tabpanel"
                aria-labelledby="vtf-tab-single"
                style={{ display: 'grid', gap: '0.7rem' }}
              >
                <button
                  type="button"
                  class="btn-primary btn-lg"
                  onClick={captureCurrentFrame}
                  disabled={!videoMeta?.width || isExtracting}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
                    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" stroke-linecap="round" />
                    <circle cx="12" cy="12" r="3.5" />
                  </svg>
                  {tr('tool.captureFrameBtn')}
                </button>
                <div class="shortcut-note">
                  {tr('tool.shortcutHint')
                    .split('•')
                    .map((item) => (
                      <span class="shortcut-chip" key={item}>
                        {item.trim()}
                      </span>
                    ))}
                </div>
              </div>
            )}

            {/* Mode 2 Controls: Auto Batch */}
            {mode === 'batch' && (
              <div
                id="vtf-panel-batch"
                role="tabpanel"
                aria-labelledby="vtf-tab-batch"
                class="batch-card"
              >
                <div>
                  <span class="control-group-label">{tr('tool.batchStrategyLabel')}</span>
                  <div class="segmented">
                    <button
                      type="button"
                      class={`segment-btn ${batchRule === 'seconds' ? 'is-active' : ''}`}
                      onClick={() => setBatchRule('seconds')}
                      disabled={isExtracting}
                    >
                      {tr('tool.batchEverySeconds')}
                    </button>
                    <button
                      type="button"
                      class={`segment-btn ${batchRule === 'fps' ? 'is-active' : ''}`}
                      onClick={() => setBatchRule('fps')}
                      disabled={isExtracting}
                    >
                      {tr('tool.batchFps')}
                    </button>
                  </div>
                </div>

                {batchRule === 'seconds' ? (
                  <div style={{ display: 'grid', gap: '0.5rem' }}>
                    <div class="preset-row">
                      {SECONDS_PRESETS.map((val) => (
                        <button
                          key={val}
                          type="button"
                          class={`preset-chip mono-num ${secondsInterval === val ? 'is-active' : ''}`}
                          onClick={() => setSecondsInterval(val)}
                          disabled={isExtracting}
                        >
                          {val}
                          {tr('tool.secondsUnit')}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      class="field-input mono-num"
                      aria-label={tr('tool.batchEverySeconds')}
                      min={0.05}
                      max={3600}
                      step={0.1}
                      value={secondsInterval}
                      disabled={isExtracting}
                      onInput={(ev) => {
                        const v = parseFloat((ev.currentTarget as HTMLInputElement).value);
                        if (Number.isFinite(v) && v > 0) setSecondsInterval(v);
                      }}
                    />
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: '0.5rem' }}>
                    <div class="preset-row">
                      {FPS_PRESETS.map((val) => (
                        <button
                          key={val}
                          type="button"
                          class={`preset-chip mono-num ${fpsValue === val ? 'is-active' : ''}`}
                          onClick={() => setFpsValue(val)}
                          disabled={isExtracting}
                        >
                          {val} {tr('tool.fpsUnit')}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      class="field-input mono-num"
                      aria-label={tr('tool.batchFps')}
                      min={0.1}
                      max={60}
                      step={0.5}
                      value={fpsValue}
                      disabled={isExtracting}
                      onInput={(ev) => {
                        const v = parseFloat((ev.currentTarget as HTMLInputElement).value);
                        if (Number.isFinite(v) && v > 0) setFpsValue(v);
                      }}
                    />
                  </div>
                )}

                <div class="two-col-inputs">
                  <div class="trim-box">
                    <div class="trim-box-head">
                      <label htmlFor="vtf-trim-start">{tr('tool.trimStart')}</label>
                      <button
                        type="button"
                        class="link-tiny-btn"
                        disabled={isExtracting}
                        onClick={() => setTrimStart(Number(currentTime.toFixed(2)))}
                      >
                        {tr('tool.useCurrentTime')}
                      </button>
                    </div>
                    <input
                      id="vtf-trim-start"
                      type="number"
                      class="field-input mono-num"
                      min={0}
                      max={videoMeta?.duration || 0}
                      step={0.1}
                      value={trimStart}
                      disabled={isExtracting}
                      onInput={(ev) => {
                        const v = parseFloat((ev.currentTarget as HTMLInputElement).value);
                        if (Number.isFinite(v) && v >= 0) setTrimStart(v);
                      }}
                    />
                  </div>

                  <div class="trim-box">
                    <div class="trim-box-head">
                      <label htmlFor="vtf-trim-end">{tr('tool.trimEnd')}</label>
                      <button
                        type="button"
                        class="link-tiny-btn"
                        disabled={isExtracting}
                        onClick={() => setTrimEnd(Number(currentTime.toFixed(2)))}
                      >
                        {tr('tool.useCurrentTime')}
                      </button>
                    </div>
                    <input
                      id="vtf-trim-end"
                      type="number"
                      class="field-input mono-num"
                      min={0}
                      max={videoMeta?.duration || 0}
                      step={0.1}
                      value={trimEnd}
                      disabled={isExtracting}
                      onInput={(ev) => {
                        const v = parseFloat((ev.currentTarget as HTMLInputElement).value);
                        if (Number.isFinite(v) && v >= 0) setTrimEnd(v);
                      }}
                    />
                  </div>
                </div>

                <div class="estimate-bar">
                  <span>{tr('tool.estimatedOutput')}</span>
                  <span class="mono-num">
                    {estimatedBatchTimestamps.length} {tr('tool.framesUnit')}
                  </span>
                </div>

                {estimatedBatchTimestamps.length > 250 && (
                  <div class="alert-banner alert-warning" style={{ marginBottom: 0 }}>
                    <span>{tr('tool.highCountWarning')}</span>
                  </div>
                )}

                {isExtracting ? (
                  <div class="progress-box">
                    <div class="progress-header">
                      <span>
                        {tr('tool.extractingProgress')} {progress.current} {tr('tool.of')} {progress.total}
                      </span>
                      <span class="mono-num">{progressPct}%</span>
                    </div>
                    <div class="progress-track" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
                      <div class="progress-fill" style={{ width: `${progressPct}%` }} />
                    </div>
                    <button type="button" class="btn-danger btn-sm" onClick={cancelBatchExtraction}>
                      {tr('tool.cancelBtn')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    class="btn-primary btn-lg"
                    onClick={runBatchExtraction}
                    disabled={!videoMeta?.width || estimatedBatchTimestamps.length === 0}
                  >
                    {tr('tool.extractAllBtn')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        </>
      )}

      {/* Extracted Frames Preview Grid */}
      {(videoUrl || frames.length > 0) && (
        <div class="gallery-section">
          <div class="gallery-header">
            <div class="gallery-title-wrap">
              <h2 class="gallery-title">{tr('tool.galleryTitle')}</h2>
              <span class="count-badge mono-num">{frames.length}</span>
            </div>

            {frames.length > 0 && (
              <div class="gallery-actions">
                <button
                  type="button"
                  class="btn-ghost btn-sm"
                  onClick={clearGallery}
                  disabled={isExtracting || isZipping}
                >
                  {tr('tool.clearAllBtn')}
                </button>
                <button
                  type="button"
                  class="btn-primary btn-sm"
                  onClick={handleDownloadZip}
                  disabled={isZipping}
                  aria-busy={isZipping}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
                    <path d="M12 4v11m0 0-4-4m4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
                    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke-linecap="round" />
                  </svg>
                  {isZipping ? tr('tool.zippingBtn') : tr('tool.downloadZipBtn')}
                </button>
              </div>
            )}
          </div>

          {frames.length === 0 ? (
            <div class="empty-gallery">{tr('tool.emptyGalleryHint')}</div>
          ) : (
            <div class="frames-grid">
              {frames.map((frame, i) => (
                <article
                  key={frame.id}
                  class="frame-card"
                  style={{ animationDelay: `${Math.min(i * 20, 220)}ms` }}
                >
                  <button
                    type="button"
                    class="frame-thumb-btn"
                    aria-label={`${tr('tool.inspectFrameBtn')} #${frame.index}`}
                    onClick={(ev) => {
                      lastLightboxTriggerRef.current = ev.currentTarget as HTMLElement;
                      setLightboxIdx(i);
                    }}
                  >
                    <img
                      src={frame.objectUrl}
                      width={frame.width}
                      height={frame.height}
                      alt={`${tr('tool.framePrefix')} #${frame.index} (${formatTimestamp(frame.timestamp)}, ${frame.width}x${frame.height} ${frame.format.toUpperCase()})`}
                      loading="lazy"
                    />
                    <span class="frame-index-pill mono-num">#{String(frame.index).padStart(3, '0')}</span>
                  </button>

                  <div class="frame-body">
                    <div class="frame-meta-row">
                      <span class="mono-num">{formatTimestamp(frame.timestamp)}</span>
                      <span class="frame-sub-meta mono-num">
                        {frame.format.toUpperCase()} • {formatBytes(frame.blob.size)}
                      </span>
                    </div>
                    <div class="frame-card-actions">
                      <button
                        type="button"
                        class="btn-primary btn-sm"
                        onClick={() => triggerBlobDownload(frame.blob, frame.filename)}
                      >
                        {tr('tool.downloadSingleBtn')}
                      </button>
                      <button
                        type="button"
                        class="btn-ghost btn-sm"
                        aria-label={`${tr('tool.removeFrameBtn')} #${frame.index}`}
                        onClick={() => removeFrame(frame.id)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lightbox Full-Size Frame Inspector */}
      {activeLightboxFrame && lightboxIdx !== null && (
        <div
          class="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`${tr('tool.framePrefix')} #${activeLightboxFrame.index}`}
          onClick={(ev) => {
            if (ev.target === ev.currentTarget) closeLightbox();
          }}
        >
          <div class="lightbox-card" ref={lightboxRef}>
            <div class="lightbox-media">
              <img
                src={activeLightboxFrame.objectUrl}
                width={activeLightboxFrame.width}
                height={activeLightboxFrame.height}
                alt={`${tr('tool.framePrefix')} #${activeLightboxFrame.index} (${formatTimestamp(activeLightboxFrame.timestamp)}, ${activeLightboxFrame.width}x${activeLightboxFrame.height} ${activeLightboxFrame.format.toUpperCase()})`}
              />
            </div>

            <div class="lightbox-bar">
              <div class="mono-num" style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                #{activeLightboxFrame.index} • {formatTimestamp(activeLightboxFrame.timestamp)} •{' '}
                {activeLightboxFrame.width}×{activeLightboxFrame.height} •{' '}
                {formatBytes(activeLightboxFrame.blob.size)}
              </div>
              <div class="gallery-actions">
                <button
                  type="button"
                  class="btn-secondary btn-sm"
                  disabled={lightboxIdx <= 0}
                  onClick={() => setLightboxIdx((idx) => (idx !== null && idx > 0 ? idx - 1 : idx))}
                >
                  ← {tr('tool.lightboxPrev')}
                </button>
                <button
                  type="button"
                  class="btn-secondary btn-sm"
                  disabled={lightboxIdx >= frames.length - 1}
                  onClick={() =>
                    setLightboxIdx((idx) =>
                      idx !== null && idx < frames.length - 1 ? idx + 1 : idx
                    )
                  }
                >
                  {tr('tool.lightboxNext')} →
                </button>
                <button
                  type="button"
                  class="btn-primary btn-sm"
                  onClick={() =>
                    triggerBlobDownload(activeLightboxFrame.blob, activeLightboxFrame.filename)
                  }
                >
                  {tr('tool.downloadSingleBtn')}
                </button>
                <button
                  ref={lightboxCloseRef}
                  type="button"
                  class="btn-ghost btn-sm"
                  onClick={closeLightbox}
                >
                  {tr('pwa.closeModal')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
