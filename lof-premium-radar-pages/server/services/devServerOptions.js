export function resolveDevHmrPort({ port, env = process.env } = {}) {
  const configured = Number(env.HMR_PORT);
  if (Number.isInteger(configured) && configured > 0 && configured <= 65535) return configured;

  const derived = Number(port) + 10_000;
  return Number.isInteger(derived) && derived > 0 && derived <= 65535 ? derived : 24678;
}

export function createDevServerOptions({ root, port, env = process.env } = {}) {
  const hmrPort = resolveDevHmrPort({ port, env });
  return {
    root,
    server: {
      middlewareMode: true,
      hmr: {
        host: '127.0.0.1',
        port: hmrPort,
        clientPort: hmrPort,
      },
    },
    appType: 'spa',
  };
}
