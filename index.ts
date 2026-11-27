/**
 * OpenCode plugin entry point.
 *
 * The runtime looks for `index.ts` at the plugin directory root, so this file
 * bridges to the modular source in `src/`. Nothing else lives at the root.
 */
export { default } from "./src/plugin.ts"
