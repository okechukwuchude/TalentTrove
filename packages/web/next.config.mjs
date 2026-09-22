/** @type {import('next').NextConfig} */
const nextConfig = {
  // @react-pdf/renderer (lib/tailoring/resume-template.tsx) renders through
  // pdfkit, which loads its built-in Helvetica/Helvetica-Bold font metrics via
  // Node's package `imports` map (pdfkit's "#standard-fonts/*" -> js/standard-fonts/*.cjs)
  // rather than a statically analyzable require. Next's build-time file tracer
  // doesn't follow that indirection, so the font files got dropped from the
  // deployed Vercel function and every resume tailoring call failed at runtime
  // with "Cannot find module '.../pdfkit/js/standard-fonts/Helvetica.cjs'" even
  // though pdfkit is a real, installed dependency. Force them in explicitly.
  outputFileTracingIncludes: {
    '/api/cron/tailor-resumes': [
      '../../node_modules/pdfkit/js/standard-fonts/**/*',
      '../../node_modules/pdfkit/js/data/**/*',
    ],
  },
};

export default nextConfig;
