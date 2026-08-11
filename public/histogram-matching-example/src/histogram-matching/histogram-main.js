import { matchHistogramsRGB, matchHistogramsColorspaces, COLOR_SPACE } from './histogram-utils.js';
// Full CDN URL, not the bare "geotiff" specifier — see histogram-utils.js's
// color-convert import comment for why.
import { fromBlob, writeArrayBuffer } from 'https://esm.sh/geotiff@2.1.3'

/**
 * Check if file is TIFF
 * @param {File|string} fileOrUrl - File object or data URL
 * @returns {boolean} True if TIFF
 */
function isTIFF(fileOrUrl) {
  return (typeof fileOrUrl !== "string" && fileOrUrl.type === "image/tiff") ||
          (typeof fileOrUrl === "string" && fileOrUrl.startsWith("data:image/tiff;base64,"));
}

const DEFAULT_SETTINGS = {
  maxMpx: -1,
  colorSpace: COLOR_SPACE.RGB,
  bands: [1, 2, 3],
  binCount: 256
}
/**
 * Load image (regular or GeoTIFF)
 * @param {File|string} fileOrUrl - File object or URL
 * @param {string} slot - 'source' or 'target'
 * @param {number} maxMpx - Max megapixels for processing
 * @returns {Promise<void>}
 */
async function loadImage(fileOrUrl, slot, settings=DEFAULT_SETTINGS) {
  try {
    if (isTIFF(fileOrUrl)) {
      await loadGeoTIFF(fileOrUrl, slot, settings);
    } else {
      await loadRegularImage(fileOrUrl, slot, settings);
    }
  } catch (error) {
    console.error(`Failed to load ${slot} image:`, error);
    throw error;
  }
}

/**
 * Load regular image (PNG, JPEG)
 * @param {File|string} fileOrUrl - File object or URL
 * @param {string} slot - 'source' or 'target'
 * @param {number} maxMpx - Max megapixels for processing
 * @returns {Promise<void>}
 */
async function loadRegularImage(fileOrUrl, slot, settings=DEFAULT_SETTINGS) {
  let imageBitmap, canvas, ctx;
  if (fileOrUrl instanceof Blob) {
    // Local File or Blob → direct decode
    imageBitmap = await createImageBitmap(fileOrUrl);
    canvas = document.createElement("canvas");
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;
    ctx = canvas.getContext("2d");
    ctx.drawImage(imageBitmap, 0, 0);
  } else if (typeof fileOrUrl === "string") {
    // URL or data URL → load via <img>
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = fileOrUrl;
    });
    canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
  } else {
    throw new Error("Unsupported fileOrUrl type in loadRegularImage");
  }

  const pixelsArr = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  imageObjects[slot] = {
    ctx,
    canvas,
    pixelsArr,
  };
  document.getElementById(slot + "-img-div").replaceChildren(canvas);
}

/**
 * Load GeoTIFF image
 * @param {File|string} fileOrUrl - File object or data URL
 * @param {string} slot - 'source' or 'target'
 * @param {number} maxMpx - Max megapixels for processing
 * @returns {Promise<void>}
 */
async function loadGeoTIFF(file, slot, settings=DEFAULT_SETTINGS) {
  const tiff = await fromBlob(file);
  const image = await tiff.getImage();
  const rasters = await image.readRasters({ interleave: true });

  const width = image.getWidth();
  const height = image.getHeight();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(rasters);
  ctx.putImageData(imageData, 0, 0);
  const pixelsArr = ctx.getImageData(0, 0, width, height).data;

  imageObjects[slot] = {
    canvas,
    pixelsArr,
    geoMetadata: {
      geoKeys: image.getGeoKeys(),
      fileDirectory: image.fileDirectory,
      image
    }
  };

  document.getElementById(slot + "-img-div").replaceChildren(canvas);
}

/**
 * Process histogram matching between loaded images
 * @param {number} maxMpx - Max megapixels for processing
 * @returns {Promise<void>}
 */
async function processMatching(settings=DEFAULT_SETTINGS) {
  const sourceCanvas = imageObjects.source.canvas;
  const sourceArr = imageObjects.source.pixelsArr;
  const targetArr = imageObjects.target.pixelsArr;

  // Perform histogram matching
  const start = Date.now();

  let matched
  if (settings.colorSpace === COLOR_SPACE.RGB) {
    matched = matchHistogramsRGB(
        sourceArr,
        targetArr,
        4,
        'MATCHED_DATA', settings.maxMpx
      )
  } else {
    matched = matchHistogramsColorspaces(
    sourceArr,
    targetArr,
    4,
    {
      returnType: 'MATCHED_DATA',
      ...settings
    }
  )
  }

  const elapsed_ms = Date.now() - start;

  // Create output canvas
  const outCanvas = document.createElement("canvas");
  outCanvas.width = sourceCanvas.width;
  outCanvas.height = sourceCanvas.height;
  const ctxOut = outCanvas.getContext("2d");
  const outData = ctxOut.createImageData(outCanvas.width, outCanvas.height);
  outData.data.set(matched.matched);
  ctxOut.putImageData(outData, 0, 0);

  // Display results and handle exports
  await displayResults(outCanvas, matched, elapsed_ms);
}

/**
 * Display processing results
 * @param {HTMLCanvasElement} outCanvas - Output canvas
 * @param {Object} matched - Matching results
 * @param {number} elapsed_ms - Processing time
 * @returns {Promise<void>}
 */
async function displayResults(outCanvas, matched, elapsed_ms) {
  const container = document.getElementById('matched-img-div');

  // Make download Link/Button
  const headerContainer = document.getElementById('matched-header');
  const a = document.createElement("a");
  headerContainer.innerHTML = 'MATCHED OUTPUT <br/>';
  headerContainer.appendChild(a);
  a.innerHTML = '<button type="button">Download</button>'
  a.download = 'sourced-geotiff-matched-to-target.tiff';

  // Convert to image and display
  outCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const img = document.createElement("img");
    img.src = url;
    if (!imageObjects.source.geoMetadata)
      a.href = url;
    container.replaceChildren(img);

    // Add statistics
    const statsDiv = document.getElementById('output-stats')
    const sourceMpix = (imageObjects.source.canvas.width * imageObjects.source.canvas.height / 1e6).toFixed(2);
    const targetMpix = (imageObjects.target.canvas.width * imageObjects.target.canvas.height / 1e6).toFixed(2);
    statsDiv.textContent = `Histogram matching took ${elapsed_ms}ms \nSource: ${sourceMpix}Mpx (${imageObjects.source.canvas.width} x ${imageObjects.source.canvas.height})\nTarget: ${targetMpix}Mpx (${imageObjects.target.canvas.width} x ${imageObjects.target.canvas.height})`;
  }, "image/png");

  // Handle GeoTIFF export
  if (imageObjects.source.geoMetadata) {
    const outUrl = await exportGeoTIFF(matched.matched, imageObjects.source.geoMetadata);
    a.href = outUrl;
  }

  // Render Histograms
  renderHistograms(matched.mappings)
}

/**
 * Export GeoTIFF file
 * @param {Uint8Array} raster - Image data
 * @param {Object} geoMetadata - Geospatial metadata
 * @returns {Promise<string>} Download URL
 */
async function exportGeoTIFF(raster, geoMetadata) {
  const { ModelPixelScale, ModelTiepoint, ImageWidth: width, ImageLength: height } = geoMetadata.fileDirectory;
  const metadata = {
    width,
    height,
    ModelPixelScale,
    ModelTiepoint,
    GTRasterTypeGeoKey: geoMetadata.geoKeys.GTRasterTypeGeoKey || 1,
    GTModelTypeGeoKey: geoMetadata.geoKeys.GTModelTypeGeoKey || 2,
    GeographicTypeGeoKey: geoMetadata.geoKeys.GeographicTypeGeoKey || 4326,
    // HTML DOM canavs exports interleaved RGBA 8 bits per channel
    SamplesPerPixel: 4,           // 4 channels RGBA from canvas
    BitsPerSample: [8, 8, 8, 8],  // 8 bits per channel
    PlanarConfiguration: 1,       // interleaved
    PhotometricInterpretation: 2, // RGB
  };

  const arrayBuffer = await writeArrayBuffer(raster, metadata);
  const blob = new Blob([arrayBuffer], { type: "image/tiff" });
  return URL.createObjectURL(blob);
}

/**
 * Get current maxMpx value from input
 * @returns {number} Current maxMpx value
 */
function getInputSettings() {
  const maxMpxInput = document.getElementById("max-mpx-input");
  const maxMpx = parseFloat(maxMpxInput.value) || 0;
  const colorSpaceInput = document.getElementById("colorSpace-input");
  const colorSpace = colorSpaceInput.value;
  const bandsInput = document.getElementById("bands-input");
  const bands = bandsInput.value.trim().split(',')
  const binCountInput = document.getElementById("binCount-input");
  const binCount = parseFloat(binCountInput.value) || 256;

  return {
    maxMpx,
    colorSpace,
    bands,
    binCount
  }
}

/**
 * Handle file input change
 * @param {Event} e - Input change event
 */
async function handleFileInput(e) {
  const slot = e.target.id.includes('source') ? 'source' : 'target';
  const file = e.target.files[0];
  if (!file) return;
  const settings = getInputSettings()

  await loadImage(file, slot, settings);
  if (imageObjects.source && imageObjects.target) {
    await processMatching(settings);
  }
}


// -------------------------------------
// Chartjs for plotting histograms
// -------------------------------------

/**
 * Render histogram chart
 * @param {Object} histData - Histogram data with R, G, B properties
 * @param {HTMLElement} element - DOM element to render chart
 * @param {string} title - Chart title
 * @returns {Chart} Chart.js instance
 */
function renderHistogram(histData, element, title = 'Histogram') {
  const commonLineOpts = {
    fill: true,
    pointRadius: 0,
    borderWidth: 1,
  };

  const histChartOpts = {
    plugins: {
      title: { display: true, text: title },
      legend: { display: false },
      tooltip: { enabled: false }
    },
    scales: {
      x: {
        type: 'linear',
        ticks: { display: false, stepSize: 50 },
        grid: { display: true },
      },
      y: {
        type: 'linear',
        ticks: { display: false, stepSize: 0.005 },
        grid: { display: true },
      }
    }
  };

  // Destroy existing chart if present
  if (Chart.getChart(element)) {
    Chart.getChart(element).destroy();
  }

  const chart = new Chart(element, {
    type: 'line',
    data: {
      labels: Array.from({ length: histData[0].length }, (_, i) => i),
      datasets: [
        {
          data: histData[0] || 0,
          borderColor: 'rgba(255,0,0,0.8)',
          backgroundColor: 'rgba(255,0,0,0.15)',
          ...commonLineOpts
        },
        {
          data: histData[1] || 0,
          borderColor: 'rgba(0,255,0,0.8)',
          backgroundColor: 'rgba(0,255,0,0.15)',
          ...commonLineOpts
        },
        {
          data: histData[2] || 0,
          borderColor: 'rgba(0,0,255,0.8)',
          backgroundColor: 'rgba(0,0,255,0.15)',
          ...commonLineOpts
        }
      ]
    },
    options: histChartOpts
  });

  return chart;
}

/**
 * Get or create histogram canvas element
 * @param {string} containerId - Container element ID
 * @param {string} canvasId - Canvas element ID
 * @returns {HTMLElement} Canvas element
 */
function getOrCreateHistogramCanvas(containerId, canvasId) {
  let canvas = document.getElementById(canvasId);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = canvasId;
    document.getElementById(containerId).replaceChildren(canvas);
  }
  return canvas;
}

/**
 * Render histograms for source and target images
 * @param {Array} mappings - Histogram mappings from processing
 */
function renderHistograms(mappings) {
  // Create histogram canvases if they don't exist
  const srcHistCanvas = getOrCreateHistogramCanvas('source-hist-chart', 'source-histogram');
  const tgtHistCanvas = getOrCreateHistogramCanvas('target-hist-chart', 'target-histogram');

  // Prepare histogram data
  const srcHistData = [0, 1, 2].map(i => mappings[i]?.srcHist)
  const tgtHistData = [0, 1, 2].map(i => mappings[i]?.tgtHist)

  // Render charts
  charts.source = renderHistogram(srcHistData, srcHistCanvas, 'Source Histogram');
  charts.target = renderHistogram(tgtHistData, tgtHistCanvas, 'Target Histogram');
}


// -------------------------------------
// Main application initialization
// -------------------------------------

// Global variables
let charts = {}
let imageObjects = {}

/**
 * Set up DOM event listeners
 */
function setupEventListeners() {
  const sourceInput = document.getElementById("source-input");
  const targetInput = document.getElementById("target-input");

  if (sourceInput) {
    sourceInput.addEventListener("change", (e) => handleFileInput(e));
  }
  if (targetInput) {
    targetInput.addEventListener("change", (e) => handleFileInput(e));
  }

  // Add settings
  async function handleSettingsChange (e) {
    document.getElementById("bands-input").disabled = document.getElementById("binCount-input").disabled = (colorSpaceInput.value === COLOR_SPACE.RGB)
    const settings = getInputSettings()
    await processMatching(settings)
  }
  document.getElementById("max-mpx-input").addEventListener("change", handleSettingsChange);
  const bandsInput = document.getElementById("bands-input")
  bandsInput.addEventListener("change", handleSettingsChange);
  const binCountInput = document.getElementById("binCount-input")
  binCountInput.addEventListener("change", handleSettingsChange);

  // Add options to color-spaces select
  const colorSpaceInput = document.getElementById("colorSpace-input")
  colorSpaceInput.addEventListener("change", handleSettingsChange);
  if (colorSpaceInput.children.length == 0) {
    for (const [key, value] of Object.entries(COLOR_SPACE)) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.innerHTML = key;
      colorSpaceInput.appendChild(opt);
    }
  }
  colorSpaceInput.value = COLOR_SPACE.RGB
  document.getElementById("bands-input").disabled = document.getElementById("binCount-input").disabled = (colorSpaceInput.value === COLOR_SPACE.RGB)
}

/**
 * Load default images if available
 */
async function loadDefaultImages() {
  const settings = getInputSettings()
  try {
    await Promise.allSettled([
      loadImage('../../source1.jpg', "source", settings),
      loadImage('../../reference1.jpg', "target", settings)
    ]);
    if (imageObjects.source && imageObjects.target) {
      await processMatching(settings);
    }
  } catch (error) {
    console.log('Default images not available, waiting for user input');
  }
}

// Initialize application when DOM is ready
function init() {
  setupEventListeners();
  loadDefaultImages();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
