Entry points for `npm run size`. Each is a tiny module that re-exports what a realistic
application would import — a re-export rather than a bare `import`, so the bundler keeps it
instead of tree-shaking the whole file away.

They read from `dist/`, so `npm run build` has to have run first.
