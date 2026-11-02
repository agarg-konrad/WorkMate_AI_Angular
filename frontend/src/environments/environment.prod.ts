// Production: nginx serves the app and reverse-proxies /api to the backend on the same origin.
export const environment = {
  production: true,
  apiBaseUrl: '/api/v1',
};
