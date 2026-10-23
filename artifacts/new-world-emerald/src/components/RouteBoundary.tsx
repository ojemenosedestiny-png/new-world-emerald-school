import { Component, Suspense, type ReactNode } from "react";
import { Link } from "wouter";

export class RouteBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-secondary px-4 py-16 text-white">
          <section className="w-full max-w-lg rounded-3xl bg-white/10 p-8" role="alert">
            <h1 className="font-serif text-3xl font-bold">This page could not be loaded</h1>
            <p className="mt-4">
              Check your connection and reload the page to try again.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-lg bg-white px-4 py-2 font-semibold text-secondary"
            >
              Reload page
            </button>
            <Link href="/" className="mt-6 block underline">Return to the school website</Link>
          </section>
        </main>
      );
    }

    return (
      <Suspense fallback={
        <main className="flex min-h-screen items-center justify-center bg-secondary px-4 text-white">
          <p role="status" aria-live="polite">Loading page…</p>
        </main>
      }>
        {this.props.children}
      </Suspense>
    );
  }
}
