import { api } from "./api";

export const supabaseFunctionUrl = (name: string) => `/api/actions/${name}`;
export const supabasePublishableKey = "";

const invoke = async (name: string, options?: { body?: unknown; headers?: Record<string, string>; method?: string }) => {
  const method = options?.method || "POST";
  const response = await fetch(supabaseFunctionUrl(name), {
    body: options?.body !== undefined && method !== "GET" ? JSON.stringify(options.body) : undefined,
    credentials: "include",
    headers: {
      ...(options?.body !== undefined && method !== "GET" ? { "content-type": "application/json" } : {}),
      ...options?.headers
    },
    method
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return { data: null, error: { message: data?.error || data?.message || `Request failed (${response.status})` } };
  }
  return { data, error: null };
};

export const supabase = {
  auth: {
    getSession: () => api.auth.getSession(),
    async getUser() {
      const { data, error } = await api.auth.getSession();
      return { data: { user: data.session?.user ?? null }, error };
    },
    onAuthStateChange: api.auth.onAuthStateChange.bind(api.auth),
    signInWithOAuth: api.auth.signInWithOAuth.bind(api.auth),
    signInWithPassword: api.auth.signInWithPassword.bind(api.auth),
    signOut: () => api.auth.signOut(),
    signUp: (credentials: { email: string; password: string }) => api.auth.signUp(credentials)
  },
  functions: { invoke },
  storage: {
    from(bucket: string) {
      return {
        getPublicUrl(path: string) {
          const encoded = path.split("/").map(encodeURIComponent).join("/");
          return { data: { publicUrl: `/api/files/${bucket}/${encoded}` } };
        },
        async upload(_path: string, _file: Blob, _options?: { cacheControl?: string; contentType?: string; upsert?: boolean }) {
          return { data: null, error: { message: "Reel uploads stay on this computer, but that transfer is not wired yet." } };
        }
      };
    }
  }
};
