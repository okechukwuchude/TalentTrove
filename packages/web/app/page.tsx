import { coverageOf } from '@pinloop/shared';

export default function HomePage() {
  const coverage = coverageOf(0, 0);
  return (
    <main>
      <h1>Pinloop</h1>
      <p>
        packages/web is wired up. Shared coverage helper says {coverage.covered}/{coverage.total}.
      </p>
    </main>
  );
}
