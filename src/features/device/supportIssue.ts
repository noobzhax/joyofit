import type { SupportReport } from '@/wear';

export const REPO_URL = 'https://github.com/dzulfikar08/joyofit';

/** Browsers and GitHub start refusing long links around 8 KB; the summary is cut to stay well under it. */
const MAX_URL = 7000;

/** The whole report as one text, for the clipboard and the share sheet. */
export function reportText(report: SupportReport): string {
  return `${report.summary}\n\n${report.log}`;
}

/**
 * A new issue from `.github/ISSUE_TEMPLATE/watch-report.yml` with the watch and the summary filled in (GitHub fills
 * issue form fields from query parameters named by their ids). The log does not fit a link; the user pastes it.
 */
export function issueUrl(report: SupportReport): string {
  const what = report.model ?? report.watch ?? 'unknown watch';
  const params = (summary: string) =>
    Object.entries({
      template: 'watch-report.yml',
      title: `[Watch report] ${what} (${report.support})`,
      watch: `${report.watch ?? 'no name'} (${report.model ?? 'not in the list'}, ${report.support})`,
      summary,
    })
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
  let summary = report.summary;
  let url = `${REPO_URL}/issues/new?${params(summary)}`;
  while (url.length > MAX_URL && summary.length > 0) {
    summary = summary.slice(0, Math.floor(summary.length * 0.8));
    url = `${REPO_URL}/issues/new?${params(`${summary}\n(cut; the full summary is in the log)`)}`;
  }
  return url;
}
