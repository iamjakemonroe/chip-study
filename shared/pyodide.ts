/** The Pyodide release the code editor runs. The Worker serves only this one, from its own copy
 * (worker/pyodide.ts); the app loads it from there (src/workspace/code/py.worker.ts). */
export const PYODIDE_VERSION = 'v314.0.7';
/** Where a release comes from the first time, and where local dev and tests load it. */
export const PYODIDE_UPSTREAM = 'https://cdn.jsdelivr.net/pyodide/';
