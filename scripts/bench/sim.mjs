#!/usr/bin/env node
// Runner for the synthetic simulation benchmark (docs/TESTING.md "Benchmarks and long runs").
import { rebuildWorkspace, runBenchProgram } from './run.mjs';

rebuildWorkspace();
runBenchProgram('sim-tick');
