export type User = {
  id: string;
  email: string | null;
  role: string;
  created_at: string;
  last_sign_in_at: string | null;
  user_metadata: {
    avatar_url?: string;
    full_name?: string;
    name?: string;
    picture?: string;
  };
  app_metadata: Record<string, unknown>;
};

export type Session = {
  access_token: string;
  user: User;
};

export type AccountSummary = {
  billing_profile: {
    cancel_at_period_end: boolean;
    current_period_end: string | null;
    plan: "free" | "pro";
    status: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    user_id: string;
  } | null;
  image_usage: {
    generated_count: number;
    monthly_generated_count: number;
    monthly_period_start: string;
  } | null;
  monthly_saved_image_count: number;
  saved_image_count: number;
};

type AuthListener = (event: string, session: Session | null) => void;
const listeners = new Set<AuthListener>();

const notify = (event: string, session: Session | null) => {
  for (const listener of listeners) listener(event, session);
};

const readJson = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { body: null as Record<string, never> | null, error: { message: body.message || `Request failed (${response.status})` } };
  return { body, error: null };
};

export const api = {
  auth: {
    async getSession() {
      const response = await fetch("/api/auth/session", { credentials: "include" });
      const { body, error } = await readJson(response);
      if (error || !body) return { data: { session: null }, error };
      return { data: { session: (body.session ?? null) as Session | null }, error: null };
    },
    onAuthStateChange(callback: AuthListener) {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } };
    },
    async signInWithPassword(credentials: { email: string; password: string }) {
      const response = await fetch("/api/auth/sign-in", {
        body: JSON.stringify(credentials),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const { body, error } = await readJson(response);
      const session = (body?.session ?? null) as Session | null;
      if (error || !session) return { data: { session: null, user: null }, error: error ?? { message: "Sign-in failed." } };
      notify("SIGNED_IN", session);
      return { data: { session, user: session.user }, error: null };
    },
    async signUp(credentials: { email: string; password: string }) {
      const response = await fetch("/api/auth/sign-up", {
        body: JSON.stringify(credentials),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const { body, error } = await readJson(response);
      if (error) return { data: { session: null, user: null }, error };
      const session = (body?.session ?? null) as Session | null;
      if (session) notify("SIGNED_IN", session);
      return { data: { session, user: session?.user ?? null }, error: null };
    },
    async signInWithOAuth(options: { redirectTo?: string }) {
      const response = await fetch("/api/auth/oauth/google", {
        body: JSON.stringify({ redirectTo: options.redirectTo }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const { body, error } = await readJson(response);
      if (error) return { error };
      if (typeof body?.url === "string") window.location.assign(body.url);
      return { error: null };
    },
    async signOut() {
      await fetch("/api/auth/sign-out", { credentials: "include", method: "POST" });
      notify("SIGNED_OUT", null);
    }
  },
  library: {
    async list(signal?: AbortSignal) {
      try {
        const response = await fetch("/api/library", { credentials: "include", signal });
        const { body, error } = await readJson(response);
        if (error || !body) return { data: null, error: error ?? { message: "Could not load your library." } };
        return { data: body.books ?? [], error: null };
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        return { data: null, error: { message: name === "AbortError" ? "AbortError" : "Could not load your library." } };
      }
    },
    async update(id: string, patch: Record<string, unknown>) {
      const response = await fetch(`/api/library/${id}`, {
        body: JSON.stringify(patch),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "PATCH"
      });
      const { body, error } = await readJson(response);
      if (error || !body) return { data: null, error: error ?? { message: "Could not update this book." } };
      return { data: body.book, error: null };
    },
    async create(file: File, metadata: Record<string, unknown>) {
      const form = new FormData();
      form.append("metadata", JSON.stringify(metadata));
      form.append("file", file);
      const response = await fetch("/api/library", { body: form, credentials: "include", method: "POST" });
      const { body, error } = await readJson(response);
      if (error || !body) return { data: null, error: error ?? { message: "Could not save this book." } };
      return { data: body.book, error: null };
    },
    async remove(id: string) {
      const response = await fetch(`/api/library/${id}`, { credentials: "include", method: "DELETE" });
      if (response.status === 204) return { error: null };
      const { error } = await readJson(response);
      return { error: error ?? { message: "Could not delete this book." } };
    },
    async file(id: string, filename: string, type: string) {
      const response = await fetch(`/api/library/${id}/file`, { credentials: "include" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "Could not open this book.");
      }
      return new File([await response.blob()], filename, { type });
    },
    async pages(bookId: string) {
      const response = await fetch(`/api/library/${bookId}/pages`, { credentials: "include" });
      const { body, error } = await readJson(response);
      if (error || !body) return { data: null, error: error ?? { message: "Could not load pages." } };
      return { data: body.pages ?? [], error: null };
    },
    async process(bookId: string) {
      const response = await fetch(`/api/library/${bookId}/process`, { credentials: "include", method: "POST" });
      const { error } = await readJson(response);
      return { error };
    }
  },
  account: {
    async summary() {
      const response = await fetch("/api/account/summary", { credentials: "include" });
      const { body, error } = await readJson(response);
      if (error || !body) return { data: null, error: error ?? { message: "Could not load your account." } };
      return { data: body as AccountSummary, error: null };
    }
  }
};
