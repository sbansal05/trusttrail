// Backend base URL. Set VITE_BACKEND_URL in the deployment environment (Vercel);
// falls back to the local dev server so local development works unchanged.
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";
