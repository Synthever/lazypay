module.exports = {
  apps: [
    {
      name: "guspay",
      script: "src/index.js",
      cwd: "/root/workspace/Guspay/server",
      node_args: "--no-warnings",
      env: {
        NODE_ENV: "production",
        PORT: 8940,
      },
      env_file: "/root/workspace/Guspay/server/.env",
      max_memory_restart: "500M",
      restart_delay: 2000,
      autorestart: true,
    },
  ],
};
