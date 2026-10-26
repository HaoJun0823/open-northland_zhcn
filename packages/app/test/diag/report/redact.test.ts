import { describe, expect, it } from 'vitest';
import {
  NO_SECRETS,
  redactHomePaths,
  redactRouteParams,
  reportSecrets,
  scrubText,
} from '../../../src/diag/report/redact.js';

describe('report redaction', () => {
  it('takes the account name out of home paths on every desktop system', () => {
    expect(
      redactHomePaths(
        'at /Users/alice/x.js and /home/bob/y and C:\\Users\\Carol\\z and file:///D:/Users/dave/w',
      ),
    ).toBe('at /Users/~/x.js and /home/~/y and C:\\Users\\~\\z and file:///D:/Users/~/w');
  });

  it('removes keys, nicks and room ids from the query and from text that quotes them', () => {
    const route = redactRouteParams(
      new URLSearchParams(
        'map=fjord&room=Ab12 cd&nick=Ania&api=https://u:p@api.example/x?k=1&authToken=s3cret&room2=new',
      ),
    );
    expect(route.params).toEqual({
      map: 'fjord',
      room: '[redacted]',
      nick: '[redacted]',
      api: 'https://api.example/x',
      authToken: '[redacted]',
      room2: 'new',
    });
    expect(
      scrubText('href=/?room=Ab12+cd&nick=Ania joined Ab12 cd', reportSecrets(route.secrets, route.names)),
    ).toBe('href=/?room=[redacted]&nick=[redacted] joined [redacted]');
    expect(redactRouteParams(new URLSearchParams('room=new')).params).toEqual({ room: 'new' });
    // A page the document showed before, logged before the player left it for the menu.
    expect(
      scrubText('boot https://u:pw@game.example/?relay=wss://r/x&room=Zz99&nick=Ola&map=a', NO_SECRETS),
    ).toBe('boot https://game.example/?relay=wss://r/x&room=[redacted]&nick=[redacted]&map=a');
  });

  it('takes out every nick as a whole word, however short, and leaves longer words that contain it', () => {
    const secrets = reportSecrets([], ['Ola', 'Bo']);
    expect(scrubText('Ola joined; Olaf left; a violation by Bo, then Bob.', secrets)).toBe(
      '[redacted] joined; Olaf left; a violation by [redacted], then Bob.',
    );
  });

  it('keeps a server address that carries no credential, and quotes of it, as they are', () => {
    const route = redactRouteParams(
      new URLSearchParams('api=http://127.0.0.1:8796&relay=wss://r.example/ws'),
    );
    expect(route.params).toEqual({ api: 'http://127.0.0.1:8796', relay: 'wss://r.example/ws' });
    expect(route.secrets).toEqual([]);
  });
});
