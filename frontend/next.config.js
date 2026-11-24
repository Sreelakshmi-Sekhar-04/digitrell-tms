/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  // Playwright runs its own dev server in a separate build folder so it never clashes with `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};
