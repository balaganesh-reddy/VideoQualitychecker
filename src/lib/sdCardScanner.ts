export interface DetectedFile {
  name: string;
  path: string;
  size: number;
  file: File;
}

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'mts', 'm2ts', 'wmv', 'flv', 'webm', '3gp'];
const METADATA_EXTENSIONS = ['mcap', 'csv', 'json', 'txt', 'xml', 'log'];

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function isVideoFile(name: string): boolean {
  return VIDEO_EXTENSIONS.includes(extension(name));
}

function isMetadataFile(name: string): boolean {
  return METADATA_EXTENSIONS.includes(extension(name));
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
    const cleanup = () => input.remove();

    input.addEventListener('change', () => {
      if (settled) return;
      settled = true;
      const picked = input.files;
      if (!picked?.length) {
        cleanup();
        resolve(null);
        return;
      }
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

export async function pickSdCardDirectory(): Promise<ScanResult | null> {
  if (!('showDirectoryPicker' in window)) return pickSdCardViaInput();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const picker = (window as any).showDirectoryPicker;
  if (typeof picker !== 'function') return pickSdCardViaInput();

  let dirHandle: FileSystemDirectoryHandle;
  try {
    dirHandle = await picker({ mode: 'read' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    if (err instanceof DOMException || err instanceof Error) return pickSdCardViaInput();
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
  depth: number,
): Promise<void> {
  if (depth > 6) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const entry of (dirHandle as any).values()) {
    if (entry.kind === 'directory') {
      if (entry.name.startsWith('.') || entry.name === 'System Volume Information') continue;
      await scanDirectory(entry, `${path}/${entry.name}`, files, metadataFiles, depth + 1);
    } else if (entry.kind === 'file' && (isVideoFile(entry.name) || isMetadataFile(entry.name))) {
      try {
        const file: File = await entry.getFile();
        const detected: DetectedFile = { name: entry.name, path: `${path}/${entry.name}`, size: file.size, file };
        if (isVideoFile(entry.name)) files.push(detected);
        else metadataFiles.push(detected);
      } catch {
        // Ignore inaccessible files while continuing to scan the card.
      }
    }
  }
}

export function createVideoObjectUrl(file: File): string {
  return URL.createObjectURL(file);
}
