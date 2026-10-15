import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import Storage from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';

import { HuaweiWear } from '@/wear';

/** Stable URLs: the newest GitHub release always serves these two assets under the same name. */
const LATEST_BASE = 'https://github.com/dzulfikar08/joyofit/releases/latest/download';
const MANIFEST_URL = `${LATEST_BASE}/joyofit-latest.json`;
const APK_URL = `${LATEST_BASE}/joyofit.apk`;

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = 'apk_update_checked_at';
const FLAG_GRANT_READ_URI_PERMISSION = 1;

/** Written by scripts/build-release-apk.sh as `joyofit-latest.json`. */
export interface ApkUpdate {
  versionCode: number;
  versionName: string;
  size: number;
  sha256: string;
  md5?: string;
}

export type ApkCheckResult =
  | { state: 'up-to-date' }
  | { state: 'available'; update: ApkUpdate }
  | { state: 'error'; message: string };

/** Only the APK from the website updates itself; the Play build is updated by Google Play and never fetches. */
export const UPDATER_ENABLED = Platform.OS === 'android' && HuaweiWear.distribution === 'sideload';

export function installedVersion(): { versionName: string; versionCode: number } {
  const code = Number.parseInt(Application.nativeBuildVersion ?? '', 10);
  return { versionName: Application.nativeApplicationVersion ?? '-', versionCode: Number.isNaN(code) ? 0 : code };
}

async function fetchManifest(): Promise<ApkUpdate> {
  let res: Response;
  try {
    res = await fetch(MANIFEST_URL);
  } catch {
    throw new Error('Could not reach the update server. Check your internet connection.');
  }
  if (!res.ok) throw new Error(`The update server answered HTTP ${res.status}.`);
  let body: Partial<ApkUpdate>;
  try {
    body = (await res.json()) as Partial<ApkUpdate>;
  } catch {
    throw new Error('The update server sent an unreadable answer.');
  }
  if (
    typeof body.versionCode !== 'number' ||
    typeof body.versionName !== 'string' ||
    typeof body.size !== 'number' ||
    typeof body.sha256 !== 'string'
  ) {
    throw new Error('The update server sent an unreadable answer.');
  }
  return body as ApkUpdate;
}

let cached: ApkCheckResult | undefined;
let inFlight: Promise<ApkCheckResult> | undefined;

async function runCheck(): Promise<ApkCheckResult> {
  const installed = installedVersion();
  let result: ApkCheckResult;
  try {
    const update = await fetchManifest();
    result = update.versionCode > installed.versionCode ? { state: 'available', update } : { state: 'up-to-date' };
  } catch (e) {
    result = { state: 'error', message: e instanceof Error ? e.message : 'The update check failed.' };
  }
  // ReactNativeJS in logcat: `adb logcat -d | grep JoyoFit-update`.
  console.info(
    `JoyoFit-update check: installed ${installed.versionName} (${installed.versionCode}), ` +
      (result.state === 'available'
        ? `update available ${result.update.versionName} (${result.update.versionCode})`
        : result.state === 'up-to-date'
          ? 'up to date'
          : `error: ${result.message}`),
  );
  cached = result;
  if (result.state !== 'error') void Storage.setItemAsync(LAST_CHECK_KEY, String(Date.now())).catch(() => {});
  return result;
}

/** Fetch the manifest now (the Check button). Concurrent calls share one request. */
export function checkForUpdate(): Promise<ApkCheckResult> {
  inFlight ??= runCheck().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

/** At most one automatic check per day. Returns the cached result, or null when no check was due. */
export async function autoCheckForUpdate(): Promise<ApkCheckResult | null> {
  if (cached) return cached;
  const last = Number(await Storage.getItemAsync(LAST_CHECK_KEY).catch(() => null));
  if (Number.isFinite(last) && last > 0 && Date.now() - last < CHECK_INTERVAL_MS) {
    console.info('JoyoFit-update check: skipped, last check under 24 h ago');
    return null;
  }
  return checkForUpdate();
}

/**
 * Downloads the APK into cache (progress 0 to 100), verifies it against the manifest, then hands it to the system
 * installer. Android shows its own prompt, and when installs from JoyoFit are not allowed yet it asks for that first.
 */
export async function downloadAndInstall(update: ApkUpdate, onProgress: (percent: number) => void): Promise<void> {
  const destination = new File(Paths.cache, 'joyofit-update.apk');
  if (destination.exists) destination.delete();

  const task = File.createDownloadTask(APK_URL, destination, {
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (totalBytes > 0) onProgress(Math.round((bytesWritten / totalBytes) * 100));
    },
  });
  let file: File | null;
  try {
    file = await task.downloadAsync();
  } catch {
    file = null;
  }
  if (!file) throw new Error('The download failed. Check your internet connection and try again.');

  // Streamed natively: hashing a ~50 MB file in JS is slow and has failed on devices. HTTPS already covers tampering,
  // this catches truncated downloads and a manifest that points at a different file than the APK.
  let sizeOk: boolean;
  let hashOk: boolean;
  try {
    const info = file.info({ md5: true });
    sizeOk = info.size === update.size;
    hashOk = !update.md5 || info.md5?.toLowerCase() === update.md5.toLowerCase();
  } catch {
    throw new Error('The downloaded file could not be checked. Try again.');
  }
  if (!sizeOk || !hashOk) {
    file.delete();
    throw new Error('The downloaded file does not match the published release. Try again.');
  }

  const permitted = await requestInstallPermission();
  if (!permitted) return;
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: file.contentUri,
    type: 'application/vnd.android.package-archive',
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}

/** Sends the user to the 'install unknown apps' screen of JoyoFit when it is off. Returns whether installs are allowed now. */
async function requestInstallPermission(): Promise<boolean> {
  if (HuaweiWear.canRequestPackageInstalls()) return true;
  await IntentLauncher.startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES', {
    data: `package:${Application.applicationId}`,
  });
  return HuaweiWear.canRequestPackageInstalls();
}
