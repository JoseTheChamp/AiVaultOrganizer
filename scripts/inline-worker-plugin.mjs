// esbuild plugin: `import code from 'inline-worker:./some.worker.ts'` bundles that file on its own
// (as a classic script) and imports the result as a string, so a worker can be started from a Blob
// URL and the plugin still ships as a single main.js.
import path from 'node:path';
import esbuild from 'esbuild';

const PREFIX = 'inline-worker:';

/** @param {{ minify: boolean }} options */
export function inlineWorkerPlugin({ minify }) {
  return {
    name: 'inline-worker',
    setup(build) {
      build.onResolve({ filter: /^inline-worker:/ }, (args) => ({
        path: path.resolve(args.resolveDir, args.path.slice(PREFIX.length)),
        namespace: 'inline-worker',
      }));
      build.onLoad({ filter: /.*/, namespace: 'inline-worker' }, async (args) => {
        const result = await esbuild.build({
          entryPoints: [args.path],
          bundle: true,
          write: false,
          metafile: true,
          format: 'iife',
          target: 'es2022',
          platform: 'browser',
          minify,
          logLevel: 'silent',
        });
        const code = result.outputFiles[0]?.text ?? '';
        return {
          contents: `export default ${JSON.stringify(code)};`,
          loader: 'js',
          // Rebuild main.js in watch mode when any file the worker uses changes.
          watchFiles: Object.keys(result.metafile.inputs).map((input) => path.resolve(input)),
        };
      });
    },
  };
}
