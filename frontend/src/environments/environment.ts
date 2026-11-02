// Development: the Angular dev server (localhost:4200) calls FastAPI directly; the backend allows this origin via CORS.
export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:8000/api/v1',
};
