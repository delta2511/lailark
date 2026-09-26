/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: false,
  // M3.4b. A constant, deliberately: not the commit sha, not a hash of the source
  // tree. Without this, Next mints a random build id per build and embeds it in every
  // page, so two builds of identical source differed by exactly those 21 bytes and
  // the /batch/001 byte-for-byte check (CLAUDE.md §3, scripts/check-batch-001.mjs)
  // could only ever pass against the very artifact that was deployed. It could not
  // tell "the jar page changed" from "someone rebuilt", which is the one distinction
  // it exists to make.
  //
  // Do not "improve" this into a sha or a content hash. The daily guard
  // (.github/workflows/check-batch-001.yml) builds the default branch fresh and
  // compares against whatever is currently deployed; a build id that tracked the
  // commit or the tree would make every commit touching the site, but not the
  // /batch/001 page, fail that check with a difference that is not a content
  // difference. A constant makes the bytes a function of the page's content alone.
  //
  // One dependency this creates: /_next/static/lailark/* is now a stable path whose
  // contents change from build to build, which is only safe because firebase.json
  // serves ** with Cache-Control: no-cache and grants immutable only to image and
  // video extensions. If that ever changes, stale chunks will be served under a
  // matching URL.
  generateBuildId: () => "lailark",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
