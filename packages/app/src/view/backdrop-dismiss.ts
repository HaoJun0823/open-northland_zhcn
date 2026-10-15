/** Dismisses a modal on a click pressed and released on its backdrop. A plain `click` listener is not
 *  enough: a drag from inside the dialog to the backdrop, such as selecting a name field's text,
 *  clicks the common ancestor, which is the backdrop itself. `surfaces` are the elements that count
 *  as backdrop, the first holding the listeners; a `<dialog>` lists itself for its `::backdrop`. */
export function dismissOnBackdropClick(surfaces: readonly HTMLElement[], dismiss: () => void): void {
  const [host] = surfaces;
  if (host === undefined) return;
  const onSurface = (event: Event): boolean => surfaces.some((surface) => surface === event.target);
  let pressed = false;
  let released = false;
  host.addEventListener('pointerdown', (event) => {
    pressed = onSurface(event);
    released = false;
  });
  host.addEventListener('pointerup', (event) => {
    released = onSurface(event);
  });
  host.addEventListener('click', (event) => {
    const outside = pressed && released && onSurface(event);
    pressed = false;
    released = false;
    if (outside) dismiss();
  });
}
