import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { contentFetch, onContentMovedOn } from '../src/content/url.js';

const response = (redirected: boolean): Response => {
  const answer = new Response('{}');
  Object.defineProperty(answer, 'redirected', { value: redirected });
  return answer;
};

describe('contentFetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tells the registered listener once that a redirect served another build', async () => {
    const answers = [false, true, true];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(answers.shift() ?? false)),
    );
    const early = vi.fn();
    onContentMovedOn(early);

    await contentFetch('/ir.json');
    expect(early).not.toHaveBeenCalled();
    await contentFetch('/sounds/banks.json');
    await contentFetch('/sounds/banks/a.bin');
    expect(early).toHaveBeenCalledTimes(1);

    const late = vi.fn();
    onContentMovedOn(late);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('takes only content paths, since a URL or Request would skip the content prefix', () => {
    expectTypeOf(contentFetch).parameter(0).toEqualTypeOf<string>();
  });
});
