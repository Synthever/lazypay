module.exports = {
  apps: [
    {
      name: "lazypay",
      script: "src/index.js",
      cwd: "/root/workspace/lazypay/server",
      node_args: "--no-warnings",
      env: {
        NODE_ENV: "production",
        PORT: 8940,
      },
      max_memory_restart: "500M",
      restart_delay: 2000,
      autorestart: true,
    },
  ],
};
