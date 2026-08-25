import { describe, expect, it } from 'bun:test';
import { CursorSessionCookieBuilder } from '../src/shared/cursorSessionCookieBuilder.ts';

describe('CursorSessionCookieBuilder', () => {
  const builder = new CursorSessionCookieBuilder();

  it('builds a WorkosCursorSessionToken cookie from authId and access token', () => {
    const cookie = builder.build('auth0|user_01ABC', 'jwt-token');
    expect(cookie).toBe('WorkosCursorSessionToken=auth0%7Cuser_01ABC%3A%3Ajwt-token');
  });
});
