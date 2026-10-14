// Fumadocs Studio, the visual editor over content/docs (`pnpm studio`, Node 24).
// Specs tell the editor how to draw our own MDX components in visual mode;
// the renderers here are light stand-ins, not the real components (the
// editor never runs them), and the source tab still shows the raw JSX. A
// component without a spec is shown as its tags, children editable.
import { defineConfig } from '@fumadocs-editor/studio';
import { fumadocsUiComponents, type UiComponentSpec } from '@fumadocs-editor/ui';

// Screenshots live in docs/public, served by the server module below (the
// Gallery literals already carry the site's /docs prefix, it strips it).

interface GalleryItem { title: string; image: string; alt: string; href?: string }
interface GalleryGroup { category?: string; items: GalleryItem[] }

// <Gallery groups={[...]} />: the groups array is a static expression, so it
// arrives parsed in `literals.groups`; drawn as the hero plus filmstrip the
// real component shows, titles as tooltips.
const gallerySpec: UiComponentSpec = {
  name: 'Gallery',
  label: 'Gallery',
  render({ literals, selected }) {
    const groups = (literals.groups as GalleryGroup[] | undefined) ?? [];
    return (
      <div style={{ display: 'grid', gap: 12, padding: 12, borderRadius: 8, outline: selected ? '2px solid var(--fde-accent, #06f)' : '1px dashed #8884' }}>
        <small style={{ opacity: 0.6 }}>Gallery · {groups.reduce((n, g) => n + g.items.length, 0)} images (edit the list in the source tab)</small>
        {groups.map((g, gi) => (
          <div key={gi} style={{ display: 'grid', gap: 6 }}>
            {g.category && <b>{g.category}</b>}
            {g.items[0] && <img src={g.items[0].image} alt={g.items[0].alt} title={g.items[0].title} style={{ width: '100%', borderRadius: 6 }} />}
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
              {g.items.map((it, i) => (
                <img key={i} src={it.image} alt={it.alt} title={it.title} style={{ height: 56, borderRadius: 4, flex: 'none' }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  },
};

// Data-driven components with no editable content (tables built from JSON,
// the changelog, the embed builder, ...): a labelled card so the page reads
// as it is laid out, nothing to edit in place.
const leaf = (name: string, label: string): UiComponentSpec => ({
  name,
  label,
  render: ({ selected }) => (
    <div style={{ padding: '10px 14px', borderRadius: 8, background: '#8881', outline: selected ? '2px solid var(--fde-accent, #06f)' : 'none' }}>
      <b>{label}</b> <small style={{ opacity: 0.6 }}>· {name}, rendered by the site</small>
    </div>
  ),
});

export default defineConfig({
  root: 'content/docs',
  server: './fumadocs-studio.server.mjs',
  syntax: { math: true },
  components: [
    ...fumadocsUiComponents,
    gallerySpec,
    leaf('FoldableSections', 'Foldable h2 sections'),
    leaf('VizModeGrid', 'Visualization modes grid'),
    leaf('ResearchReferences', 'Research references'),
    leaf('ReferencesTableSection', 'References table section'),
    leaf('ReferencesTablecn', 'References table (tablecn)'),
    leaf('NationalDatasetsTable', 'National datasets table'),
    leaf('NationalDatasetsTablecn', 'National datasets table (tablecn)'),
    leaf('NationalCoverageMap', 'National coverage map'),
    leaf('EmbedBuilder', 'Embed builder'),
    leaf('ChangelogList', 'Changelog'),
    leaf('ScalarReference', 'API reference (Scalar)'),
    leaf('ProjectConfigTable', 'ProjectConfig table'),
    leaf('UrlParamsReference', 'URL parameters reference'),
    leaf('InstructionParamsReference', 'Instruction parameters reference'),
    leaf('StorageAtomsReference', 'Storage atoms reference'),
    leaf('VisualizationModesDescription', 'Visualization modes description'),
    leaf('SlideDecksTable', 'Slide decks table'),
    leaf('SlideDecksPdfs', 'Slide deck PDFs'),
  ],
});
