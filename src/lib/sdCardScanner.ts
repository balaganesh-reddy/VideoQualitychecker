export interface DetectedFile {
  name: string;
  path: string;
  size: number;
  file: File;
}

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'mts', 'm2ts', 'wmv', 'flv', 'webm', '3gp'];

function isVideoFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return VIDEO_EXTENSIONS.includes(ext);
}

function isMetadataFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ['mcap', 'csv', 'json', 'txt', 'xml'].includes(ext);
}

export interface ScanResult {
  files: DetectedFile[];
  metadataFiles: DetectedFile[];
  rootName: string;
}

function classifyFile(file: File, rootName: string): { video: DetectedFile | null; meta: DetectedFile | null } {
  const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const detected: DetectedFile = {
    name: file.name,
    path: relPath.startsWith(rootName) ? relPath : `${rootName}/${relPath}`,
    size: file.size,
    file,
  };
  if (isVideoFile(file.name)) return { video: detected, meta: null };
  if (isMetadataFile(file.name)) return { video: null, meta: detected };
  return { video: null, meta: null };
}

/**
 * Fallback for environments where showDirectoryPicker is blocked
 * (e.g. the dashboard runs inside an embedded preview frame).
 * Uses a hidden <input type="file" webkitdirectory>, which works in iframes
 * and in all modern browsers.
 */
export function pickSdCardViaInput(): Promise<ScanResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);

    let settled = false;
    const cleanup = () => {
      input.remove();
    };

    input.addEventListener('change', () => {
      if (settled) return;
      settled = true;

      const picked = input.files;
      if (!picked || picked.length === 0) {
        cleanup();
        resolve(null);
        return;
      }

      // webkitRelativePath looks like "CardName/sub/dir/file.mp4" — the first
      // segment is the folder the user picked (their SD card).
      const firstPath = (picked[0] as File & { webkitRelativePath?: string }).webkitRelativePath || '';
      const rootName = firstPath.split('/')[0] || 'SD Card';

      const files: DetectedFile[] = [];
      const metadataFiles: DetectedFile[] = [];

      for (const file of Array.from(picked)) {
        const { video, meta } = classifyFile(file, rootName);
        if (video) files.push(video);
        if (meta) metadataFiles.push(meta);
      }

      cleanup();
      resolve({ files, metadataFiles, rootName });
    });

    input.addEventListener('cancel', () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    });

    input.click();
  });
}

/**
 * Opens the browser directory picker so the user selects their SD card
 * (or a folder on it). Recursively scans the folder for video and metadata
 * files. Returns null if the user cancels.
 */
export async function pickSdCardDirectory(): Promise<ScanResult | null> {
  if (!('showDirectoryPicker' in window)) {
    // Browser doesn't support the modern picker (Firefox, Safari) — use the input fallback.
    return pickSdCardViaInput();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const picker = (window as any).showDirectoryPicker;
  if (typeof picker !== 'function') {
    return pickSdCardViaInput();
  }

  let dirHandle: FileSystemDirectoryHandle;
  try {
    dirHandle = await picker({ mode: 'read' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    // SecurityError (or similar) when running inside a cross-origin iframe —
    // fall back to the classic folder input, which is allowed in frames.
    if (err instanceof DOMException || err instanceof Error) {
      return pickSdCardViaInput();
    }
    throw err;
  }

  const files: DetectedFile[] = [];
  const metadataFiles: DetectedFile[] = [];

  await scanDirectory(dirHandle, dirHandle.name, files, metadataFiles, 0);

  return { files, metadataFiles, rootName: dirHandle.name };
}

async function scanDirectory(
  dirHandle: FileSystemDirectoryHandle,
  path: string,
  files: DetectedFile[],
  metadataFiles: DetectedFile[],
  depth: number
): Promise<void> {
  if (depth > 6) return; // avoid runaway recursion on huge cards

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const entry of (dirHandle as any).values()) {
    if (entry.kind === 'directory') {
      // Skip hidden/system folders that bloat the scan
      if (entry.name.startsWith('.') || entry.name === 'System Volume Information') continue;
      await scanDirectory(entry, `${path}/${entry.name}`, files, metadataFiles, depth + 1);
    } else if (entry.kind === 'file') {
      if (isVideoFile(entry.name) || isMetadataFile(entry.name)) {
        try {
          const file: File = await entry.getFile();
          const detected: DetectedFile = {
            name: entry.name,
            path: `${path}/${entry.name}`,
            size: file.size,
            file,
          };
          if (isVideoFile(entry.name)) {
            files.push(detected);
          } else {
            metadataFiles.push(detected);
          }
        } catch {
          // unreadable file — skip it
        }
      }
    }
  }
}

/**
 * Creates an object URL for in-browser video playback.
 * Caller must revoke when done.
 */
export function createVideoObjectUrl(file: File): string {
  return URL.createObjectURL(file);
}
