import { defineConfig } from 'vite'

// The demo in src/demo is the only Vite app here — the library itself is built with tsc
// (see the `build` script), so both serving and building point at the demo.
//
// `base` matters for GitHub Pages: the site is served from a subpath
// (https://<owner>.github.io/<repo>/), so the emitted asset URLs need that prefix. The
// deploy workflow passes it in via BASE_PATH; locally it stays at the root.
export default defineConfig({
  root: 'src/demo',
  base: process.env.BASE_PATH ?? '/',
  build: {
    // Deliberately not `dist/` — that belongs to the library build, which wipes it.
    // Being outside `root` is why emptyOutDir has to be spelled out.
    outDir: '../../dist-demo',
    emptyOutDir: true,
    // Three pages: the lit demo (index), the React form demo, and the React i18n one.
    rollupOptions: {
      input: {
        index: 'src/demo/index.html',
        react: 'src/demo/react.html',
        'react-i18n': 'src/demo/react-i18n.html',
      },
    },
  },
});
