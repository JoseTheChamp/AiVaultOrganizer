/** `inline-worker:<path>` imports resolve to the bundled worker code (scripts/inline-worker-plugin.mjs). */
declare module 'inline-worker:*' {
  const code: string;
  export default code;
}
