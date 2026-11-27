/** @type {import('next').NextConfig} */
const forTests = !!process.env.NEXT_DIST_DIR;

module.exports = {
  reactStrictMode: true,
  // Playwright runs its own dev server in a separate build folder so it never clashes with `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // In the test server, keep compiled pages in memory for the whole run. By default the dev server
  // drops pages after ~60 s / 5 pages, and recompiling one mid-test can exceed Playwright's timeouts.
  ...(forTests ? { onDemandEntries: { maxInactiveAge: 60 * 60 * 1000, pagesBufferLength: 100 } } : {}),
};
