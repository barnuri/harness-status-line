export class CursorSessionCookieBuilder {
  private static readonly COOKIE_NAME = 'WorkosCursorSessionToken';
  private static readonly AUTH_SEPARATOR = '::';

  build(authId: string, accessToken: string): string {
    const value = encodeURIComponent(`${authId}${CursorSessionCookieBuilder.AUTH_SEPARATOR}${accessToken}`);
    return `${CursorSessionCookieBuilder.COOKIE_NAME}=${value}`;
  }
}
