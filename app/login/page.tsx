"use client";
import { useState } from "react";

export default function Login() {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <div className="login-art">
        <span className="brand">◈ DREAD LEDGER</span>
        <h1>
          Your collection.
          <br />
          Everyone accounted for.
        </h1>
        <p>A shared home for cards, capital, and clear balances.</p>
        <div className="card-stack">
          <div>
            DL
            <span>
              COLLECTIVE
              <br />
              OWNERSHIP
            </span>
            <small>EST. 2026</small>
          </div>
        </div>
      </div>
      <section className="login-form">
        <span className="eyebrow">PARTNER ACCESS</span>
        <h2>Welcome back.</h2>
        <p>Sign in with your username and password.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              setMessage("");
              const form = new FormData(e.currentTarget);
              const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  username: form.get("username"),
                  password: form.get("password"),
                }),
              });
              const result = await response.json();
              if (!response.ok)
                setMessage(result.error || "Unable to sign in.");
              else window.location.assign("/");
            } catch {
              setMessage(
                "Unable to connect. Check the Supabase configuration.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Username
            <input
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Your username"
              required
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in →"}
          </button>
        </form>
        <p role="status">{message}</p>
        {process.env.NODE_ENV !== "production" && (
          <a className="text-link" href="/demo">
            Explore the example portfolio →
          </a>
        )}
        <small>
          Access is by invitation. Contact Joey to join or reset your password.
        </small>
      </section>
    </main>
  );
}
