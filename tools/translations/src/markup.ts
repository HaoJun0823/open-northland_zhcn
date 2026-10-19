/**
 * The markup a translated or edited map value keeps from its source text (`translations/AGENTS.md`): a
 * string's `@` goal prefix and printf placeholders, and a briefing block's hypertext tags.
 */

const GOAL_PREFIX = '@';
/** A printf conversion such as `%d`, `%s` or `%2.1f`. */
const PLACEHOLDER = /%(?:\d+\$)?[-+ #0]*\d*(?:\.\d+)?[a-zA-Z]/g;
/** A hypertext tag as the briefing reader tokenizes it: `<name>` or `<name:args>`. */
const HYPERTEXT_TAG = /<[a-z]+(?::[^>]*)?>/gi;

const sorted = (values: Iterable<string>): string => [...values].sort().join(' ');

/** Whether map string `value` lacks or adds the goal prefix or a placeholder of `source`. */
export function stringMarkupDiffers(source: string, value: string): boolean {
  return (
    source.startsWith(GOAL_PREFIX) !== value.startsWith(GOAL_PREFIX) ||
    sorted(source.match(PLACEHOLDER) ?? []) !== sorted(value.match(PLACEHOLDER) ?? [])
  );
}

/** Whether block body `value` carries other tags than `source`, by name and arguments, in order. */
export function blockMarkupDiffers(source: string, value: string): boolean {
  const tags = (body: string): string => (body.match(HYPERTEXT_TAG) ?? []).join('');
  return tags(source) !== tags(value);
}
