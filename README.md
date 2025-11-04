# Terrain Visualization Modes

A comprehensive terrain visualization tool built with Next.js, MapLibre GL, and React. Explore different terrain visualization modes including hillshade, hypsometric tinting, contour lines, and more.

## Features

- **Multiple Terrain Sources**: Matterhorn, Mapbox, MapTiler, Mapzen, AWS Elevation Tiles
- **Visualization Modes**:
  - Hillshade with multiple algorithms (Standard, Combined, Igor, Basic, Multidirectional)
  - Hypsometric Tint (color relief) with customizable color ramps
  - Contour Lines with configurable intervals
  - Terrain Raster overlay
- **View Modes**: 2D, 3D, and Globe projections
- **Split Screen**: Compare two terrain sources side-by-side
- **Download**: Export terrain as GeoTIFF via Titiler
- **Dark Mode**: Full dark theme support including MapLibre controls

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm, yarn, or pnpm

### Installation

\`\`\`bash
# Clone the repository
git clone https://github.com/yourusername/terrain-visualization-modes.git
cd terrain-visualization-modes

# Install dependencies
npm install

# Run development server
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) to view the app.

### Building for Production

\`\`\`bash
# Build static export
npm run build

# The output will be in the `out` directory
\`\`\`

### Deploying to GitHub Pages

1. Push your code to GitHub
2. Enable GitHub Pages in repository settings
3. Set source to "GitHub Actions"
4. The workflow will automatically deploy on push to main

## Configuration

### API Keys

Configure API keys in the Settings modal:
- **MapTiler API Key**: For MapTiler terrain tiles
- **Mapbox Access Token**: For Mapbox terrain and satellite imagery
- **Google Maps API Key**: For Google 3D tiles (coming soon)

### Titiler Settings

- **Titiler Endpoint**: Default is `https://titiler.xyz`
- **Max Resolution**: Maximum resolution for GeoTIFF downloads (default 4096px)

## Known Limitations

### Color Relief (Hypsometric Tint)

The true `color-relief` layer type from [MapLibre PR #5913](https://github.com/maplibre/maplibre-gl-js/pull/5913) is not yet available in MapLibre GL v5.11.0. The current implementation uses a hillshade layer as a workaround. Once PR #5913 is merged, the app will be updated to use the native color-relief layer type.

### Contour Lines

Contour lines are implemented using the [maplibre-contour](https://github.com/onthegomap/maplibre-contour) plugin. This feature requires additional setup and may have performance implications on lower-end devices.

### Google 3D Tiles

Google 3D Tiles support is planned but not yet implemented. The feature is currently disabled in the UI.

## Technologies

- **Next.js 16**: React framework with static export
- **MapLibre GL v5.11.0**: Open-source map rendering
- **React Map GL**: React wrapper for MapLibre
- **nuqs**: URL state management
- **shadcn/ui**: UI components
- **Tailwind CSS v4**: Styling
- **maplibre-contour**: Contour line generation

## Inspiration

This project was inspired by:
- [Tangram Height Mapper](https://tangrams.github.io/heightmapper/)
- [Impasto CAS Viewer](https://impasto.dev/)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use this project for any purpose.

## Resources

- [MapLibre GL Documentation](https://maplibre.org/maplibre-gl-js/docs/)
- [Hillshade Methods PR #5768](https://github.com/maplibre/maplibre-gl-js/pull/5768)
- [Hypsometric Tint PR #5913](https://github.com/maplibre/maplibre-gl-js/pull/5913)
- [Contour Lines Discussion](https://github.com/maplibre/maplibre-style-spec/issues/583)
- [CPT City Color Ramps](http://seaviewsensing.com/pub/cpt-city/)
