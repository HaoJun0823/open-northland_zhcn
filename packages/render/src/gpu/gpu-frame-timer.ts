import type { Application } from 'pixi.js';

/**
 * GPU execution time of the commands issued between `begin` and `end`, read through WebGL2's
 * `EXT_disjoint_timer_query_webgl2`. A result lands a few frames after its frame; a frame that finds
 * every query still in flight goes unmeasured rather than stalling on the GPU.
 */
export interface GpuFrameTimer {
  begin(): void;
  end(): void;
  /** Hands each landed measurement, in ms, to `take`, oldest first. */
  drain(take: (ms: number) => void): void;
  dispose(): void;
}

interface TimerQueryExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

const MAX_QUERIES_IN_FLIGHT = 4;
const NS_PER_MS = 1e6;

function timerQueryExtension(gl: WebGL2RenderingContext): TimerQueryExtension | null {
  const ext: unknown = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (typeof ext !== 'object' || ext === null) return null;
  if (!('TIME_ELAPSED_EXT' in ext) || !('GPU_DISJOINT_EXT' in ext)) return null;
  const { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT } = ext;
  if (typeof TIME_ELAPSED_EXT !== 'number' || typeof GPU_DISJOINT_EXT !== 'number') return null;
  return { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT };
}

/** Null where the renderer is not WebGL2 or the browser withholds the timer extension. */
export function createGpuFrameTimer(app: Application): GpuFrameTimer | null {
  const renderer = app.renderer;
  if (!('gl' in renderer)) return null;
  const gl = renderer.gl;
  const ext = timerQueryExtension(gl);
  if (ext === null) return null;

  const idle: WebGLQuery[] = [];
  const inFlight: WebGLQuery[] = [];
  let created = 0;
  let open: WebGLQuery | null = null;
  /** Queries still to land that a disjoint event voided; reading the flag clears it, so it is counted. */
  let voided = 0;

  const acquire = (): WebGLQuery | null => {
    const reused = idle.pop();
    if (reused !== undefined) return reused;
    if (created >= MAX_QUERIES_IN_FLIGHT) return null;
    created++;
    return gl.createQuery();
  };

  return {
    begin(): void {
      if (open !== null) return;
      open = acquire();
      if (open !== null) gl.beginQuery(ext.TIME_ELAPSED_EXT, open);
    },
    end(): void {
      if (open === null) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      inFlight.push(open);
      open = null;
    },
    drain(take): void {
      // A disjoint event (power state change, context switch) voids every result in flight.
      if (gl.getParameter(ext.GPU_DISJOINT_EXT) === true) voided = inFlight.length;
      while (inFlight.length > 0) {
        const query = inFlight[0];
        if (query === undefined) break;
        if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) !== true) break;
        inFlight.shift();
        idle.push(query);
        const ns: unknown = gl.getQueryParameter(query, gl.QUERY_RESULT);
        if (voided > 0) voided--;
        else if (typeof ns === 'number') take(ns / NS_PER_MS);
      }
    },
    dispose(): void {
      if (open !== null) gl.endQuery(ext.TIME_ELAPSED_EXT);
      for (const query of [...idle, ...inFlight]) gl.deleteQuery(query);
      idle.length = 0;
      inFlight.length = 0;
      open = null;
    },
  };
}
