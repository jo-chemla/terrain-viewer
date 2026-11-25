import type { Metadata } from 'next';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import { ScalarFull } from '@/components/scalar-full';

// The tile service's API reference on a page of its own, full width: the
// docs page /dev/tile-service links here instead of embedding it in its
// narrow column. The document is public/tile-service-openapi.json, written
// by tile-server/openapi.mjs (run by the docs build).
export const metadata: Metadata = {
  title: 'Tile service API reference',
  description: "Every address of the Terrain Viewer tile service, its parameters and answers: Scalar over the service's OpenAPI document.",
};

export default function Page() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="w-full">
        <ScalarFull url="/docs/tile-service-openapi.json" />
      </main>
    </HomeLayout>
  );
}
