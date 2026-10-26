import type { ReportError, ReportLog, ReportTrigger } from '@open-northland/data';

/** Something went wrong that a bug report should describe. */
export interface Problem {
  readonly trigger: ReportTrigger;
  readonly error?: ReportError;
  /** The game stopped for good with it: the dialog always shows, whatever the session's limits. */
  readonly fatal?: boolean;
  /** Facts the report's `perf` carries, such as a freeze's length. */
  readonly facts?: Readonly<Record<string, unknown>>;
  /** A problem a previous page recorded: the report keeps its id and time, and its log stands in for
   *  the current page's, which never saw it. */
  readonly earlier?: {
    readonly id: string;
    readonly at: string;
    readonly log?: ReportLog;
    readonly route?: { readonly entry: string; readonly params: Readonly<Record<string, string>> };
  };
}

export type ProblemSink = (problem: Problem) => void;

let sink: ProblemSink | null = null;
const waiting: Problem[] = [];

/** Hand a problem to the report flow; problems raised before it is installed wait for it. */
export function reportProblem(problem: Problem): void {
  if (sink === null) waiting.push(problem);
  else sink(problem);
}

export function setProblemSink(next: ProblemSink): void {
  sink = next;
  for (const problem of waiting.splice(0)) next(problem);
}
