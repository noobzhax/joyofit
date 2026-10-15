/** One watch face on the watch. */
export interface WatchfaceInfo {
  /** The number the watch knows the face by (no version). Pass it to `setActiveWatchface` / `deleteWatchface`. */
  id: string;
  version: string;
  /** The face's name from the watch; the id when the watch gave none. */
  name: string;
  /** The face on the watch's screen now. */
  active: boolean;
  /** Preinstalled; the watch may refuse to delete it. */
  factory: boolean;
  editable: boolean;
  video: boolean;
  photo: boolean;
  /** Trial version. */
  tryout: boolean;
  kaleidoscope: boolean;
}

/** The watch's faces and the screen size it reported in the same exchange. */
export interface WatchfaceList {
  /** Screen width in pixels from the watch's watch face parameters; null when the watch gave none. */
  width: number | null;
  /** Screen height in pixels; null when the watch gave none. */
  height: number | null;
  /** The newest watch face format version the watch accepts; null when the watch gave none. */
  maxVersion: string | null;
  faces: WatchfaceInfo[];
  /** Unix milliseconds when the list was read. */
  updatedAt: number;
}

/** What `installWatchface` resolves with when the upload ran through (the watch may still not list the face; see `listed`). */
export interface WatchfaceInstallResult {
  /** The name the face was uploaded under, `<id>_<version>`. */
  fileName: string;
  id: string;
  version: string;
  /** The title from the package's description.xml. */
  name: string;
  /** Size of the uploaded face binary. */
  bytes: number;
  /** The status in the watch's end-of-transfer packet (not documented); null when it sent none. */
  uploadStatus: number | null;
  /** The report type of the watch's confirmation (2 = the watch asked to make the face active); null when none arrived. */
  confirmReportType: number | null;
  /** The new face is in the watch's list afterwards. False means the watch dropped it. */
  listed: boolean;
  /** The new face is the active one afterwards. */
  active: boolean;
  /** One sentence describing the outcome. */
  message: string;
  /** The list read after the upload; null when the watch did not answer. */
  list: WatchfaceList | null;
}

/** `onUploadProgress`: bytes the watch has acknowledged, of the file size. */
export interface UploadProgressEvent {
  bytes: number;
  total: number;
}

/** `onUploadResult`: the end of an `installWatchface`, success or not. `code` is the watch's status when it returned one. */
export interface UploadResultEvent {
  ok: boolean;
  fileName: string;
  code: number | null;
  message: string;
}
