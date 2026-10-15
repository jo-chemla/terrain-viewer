import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Mountain } from 'lucide-react';
import { appName, gitConfig } from './shared';
import { AppIconButton } from '@/components/app-icon-button';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      // The app button sits before the name; the name stays Fumadocs' link to the docs root.
      title: (
        <span className="inline-flex items-center">
          <AppIconButton />
          {appName}
        </span>
      ),
    },
    links: [
      {
        // The app itself, at the host's root. `external` makes it a plain
        // anchor (fumadocs-core's Link), so "/" stays "/" and is not given
        // the docs' /docs basePath; the same link therefore opens whichever
        // app serves these docs (terrain-viewer or historical-satellite).
        type: 'icon',
        icon: <Mountain />,
        text: 'Open the app',
        label: 'Open the app',
        url: '/',
        external: true,
      },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
