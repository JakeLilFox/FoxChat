# FoxChat homepage

The marketing and download site for FoxChat: a landing page plus the pages
that link out to the built desktop/Android artifacts. It's a separate Vite +
React app from the client itself (see the [root README](../README.md)) and
is deployed independently.

## Building and running

```sh
npm install
npm run dev     # dev server
npm run build   # production build, output in dist/
```

CI builds this with `VITE_BUILD_VERSION` set and deploys `dist/`; see
`ci.json` in the repository root for the exact pipeline. The `Marketing`
worker captures the website screenshots into a build artifact, and the
homepage deployment publishes that artifact under `/marketing/`.
