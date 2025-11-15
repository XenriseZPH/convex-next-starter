import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "export", // To enable a static export
  trailingSlash: true, // Optional: Change links `/me` -> `/me/` and emit `/me.html` -> `/me/index.html`
  reactStrictMode: false, // prevent double rerendering
  ...(process.env.NEXT_PUBLIC_ENV && {
    compiler: {
      removeConsole: {
        exclude: ["error", "warn"], // remove logs except error and warn
      },
    },
  }),
};

export default nextConfig;
