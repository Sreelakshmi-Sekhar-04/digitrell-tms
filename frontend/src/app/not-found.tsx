import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <section className="w-full max-w-md rounded-card border border-line bg-white p-7 text-center">
        <h1 className="text-2xl font-bold">Page not found</h1>
        <p className="mt-2 text-sm text-ink-muted">The link may be old or mistyped. Your trips and bookings are safe.</p>
        <Link href="/" className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-btn bg-brand px-[18px] text-sm font-semibold text-white hover:bg-brand-dark">
          Go to Home
        </Link>
      </section>
    </main>
  );
}
