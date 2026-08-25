import { CursorAccessTokenReader } from './cursorAccessTokenReader.ts';
import { CursorCliConfigReader } from './cursorCliConfigReader.ts';
import { CursorSessionCookieBuilder } from './cursorSessionCookieBuilder.ts';
import { CursorUsageMapper } from './cursorUsageMapper.ts';
import { CursorUsageStore } from './cursorUsageStore.ts';

export class CursorUsageClient {
  private static readonly PERIOD_USAGE_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
  private static readonly AUTH_USAGE_URL = 'https://api2.cursor.sh/auth/usage';
  private static readonly USAGE_SUMMARY_URL = 'https://cursor.com/api/usage-summary';
  private static readonly FETCH_TIMEOUT_MS = 1500;
  private static refreshPromise: Promise<void> | null = null;

  private readonly tokenReader: CursorAccessTokenReader;
  private readonly configReader: CursorCliConfigReader;
  private readonly cookieBuilder: CursorSessionCookieBuilder;
  private readonly store: CursorUsageStore;
  private readonly mapper: CursorUsageMapper;
  private readonly fetchImpl: typeof fetch;

  constructor(
    tokenReader?: CursorAccessTokenReader,
    store?: CursorUsageStore,
    fetchImpl?: typeof fetch,
    configReader?: CursorCliConfigReader,
    cookieBuilder?: CursorSessionCookieBuilder,
  ) {
    this.tokenReader = tokenReader ?? new CursorAccessTokenReader();
    this.configReader = configReader ?? new CursorCliConfigReader();
    this.cookieBuilder = cookieBuilder ?? new CursorSessionCookieBuilder();
    this.store = store ?? new CursorUsageStore();
    this.mapper = new CursorUsageMapper();
    this.fetchImpl = fetchImpl ?? fetch;
  }

  refreshInBackground(nowMs: number = Date.now()): void {
    if (this.store.isFresh(nowMs)) {
      return;
    }
    if (CursorUsageClient.refreshPromise) {
      return;
    }
    CursorUsageClient.refreshPromise = this.refresh()
      .catch((err: unknown) => {
        if (!(err instanceof Error)) {
          throw err;
        }
      })
      .finally(() => {
        CursorUsageClient.refreshPromise = null;
      });
  }

  private async refresh(): Promise<void> {
    const token = this.tokenReader.read();
    if (!token) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CursorUsageClient.FETCH_TIMEOUT_MS);
    try {
      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
      };
      const authInfo = this.configReader.readAuthInfo();
      const summaryUrl = authInfo
        ? `${CursorUsageClient.USAGE_SUMMARY_URL}?teamId=${authInfo.teamId}`
        : null;
      const summaryHeaders = authInfo
        ? {
            Accept: 'application/json',
            Cookie: this.cookieBuilder.build(authInfo.authId, token),
          }
        : null;
      const [periodRaw, authRaw, summaryRaw] = await Promise.all([
        this.fetchJson(CursorUsageClient.PERIOD_USAGE_URL, {
          method: 'POST',
          headers,
          body: '{}',
          signal: controller.signal,
        }),
        this.fetchJson(CursorUsageClient.AUTH_USAGE_URL, {
          method: 'GET',
          headers,
          signal: controller.signal,
        }),
        summaryUrl && summaryHeaders
          ? this.fetchJson(summaryUrl, {
              method: 'GET',
              headers: summaryHeaders,
              signal: controller.signal,
            })
          : Promise.resolve(null),
      ]);
      const capturedAt = new Date().toISOString();
      const snapshot = this.mapper.merge(
        this.mapper.map(summaryRaw, capturedAt),
        this.mapper.merge(
          this.mapper.map(periodRaw, capturedAt),
          this.mapper.map(authRaw, capturedAt),
          capturedAt,
        ),
        capturedAt,
      );
      if (!snapshot) {
        return;
      }
      this.store.write(snapshot);
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchJson(url: string, init: RequestInit): Promise<unknown | null> {
    try {
      const response = await this.fetchImpl(url, init);
      if (!response.ok) {
        return null;
      }
      return await response.json();
    } catch (err: unknown) {
      if (err instanceof Error) {
        return null;
      }
      throw err;
    }
  }
}
