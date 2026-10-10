/** Boot-time environment facts for the log ring; browser-only, so they sit apart from the logger core. */
import { isBrave } from '../view/browser-support.js';
import { detectedWebglRenderer } from '../view/graphics-hardware.js';
import { type DiagLog, diag } from './log.js';

/** Call once at boot, before routing. */
export function logBootHeader(target: DiagLog = diag): void {
  target.info('boot', 'environment', {
    href: window.location.href,
    userAgent: navigator.userAgent,
    brave: isBrave(),
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency,
    screen: { width: window.screen.width, height: window.screen.height, dpr: window.devicePixelRatio },
    webglRenderer: detectedWebglRenderer(),
  });
}
