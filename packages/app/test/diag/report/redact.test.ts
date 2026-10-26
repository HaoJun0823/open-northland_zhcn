import { describe, expect, it } from 'vitest';
import { redactHomePaths, redactRouteParams, scrubText } from '../../../src/diag/report/redact.js';

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
    expect(scrubText('href=/?room=Ab12+cd&nick=Ania joined Ab12 cd', route.secrets)).toBe(
      'href=/?room=[redacted]&nick=[redacted] joined [redacted]',
    );
    expect(redactRouteParams(new URLSearchParams('room=new')).params).toEqual({ room: 'new' });
  });
});
