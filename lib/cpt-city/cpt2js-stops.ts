
import chroma from 'chroma-js'
import type { InterpolationMode, Scale, Palette, PaletteColor, PaletteEntry, PaletteArray, ParseOptions } from 'chroma-js';
const DEFAULT_MODE: InterpolationMode = 'rgb';

function parseValue(value_: string | number, bounds: [number, number]): number | null | undefined {
  if (typeof value_ === 'string') {
    const value = value_.trim();
    if (value[value.length - 1] === '%') {
      const percentage = parseFloat(value) / 100;
      if (percentage < 0 || percentage > 1) {
        throw new Error(`Invalid value for a percentage ${value}`);
      }
      return bounds[0] + (bounds[1] - bounds[0]) * percentage;
    } else if (value === 'N') {
      return null; // GMT nodata
    } else if (value === 'B') {
      return undefined; // GMT background (value < min), not supported yet, ignore
    } else if (value === 'F') {
      return undefined; // GMT foreground (value > max), not supported yet, ignore
    } else if (value === 'nv') {
      return null; // GDAL nodata
    } else if (value === 'default') {
      return undefined; // GRASS default (value < min || value > max), not supported yet, ignore
    } else if (value === 'null') {
      return null; // PostGIS nodata
    } else if (value === 'nodata') {
      return null; // PostGIS nodata
    } else {
      return parseFloat(value);
    }
  } else if (typeof value_ === 'number') {
    return value_;
  } else {
    throw new Error('Invalid state');
  }
}

function parseColor(color: PaletteColor, mode: InterpolationMode): object | string {
  if (Array.isArray(color)) {
    if (color.length === 4) {
      // color with alpha
      return {
        [mode[0]]: parseFloat(color[0].toString()),
        [mode[1]]: parseFloat(color[1].toString()),
        [mode[2]]: parseFloat(color[2].toString()),
        a: parseFloat(color[3].toString()) / 255,
      };
    } else if (color.length === 3) {
      // color
      return {
        [mode[0]]: parseFloat(color[0].toString()),
        [mode[1]]: parseFloat(color[1].toString()),
        [mode[2]]: parseFloat(color[2].toString()),
      };
    } else {
      throw new Error(`Invalid color ${color}`);
    }
  } else if (typeof color === 'string' || typeof color === 'number') {
    if (color.toString().match(/^\d+$/) || typeof color === 'number') {
      // grayscale color
      return {
        [mode[0]]: parseFloat(color.toString()),
        [mode[1]]: parseFloat(color.toString()),
        [mode[2]]: parseFloat(color.toString()),
      };
    } else {
      // color name
      return color;
    }
  } else {
    throw new Error(`Invalid color ${color}`);
  }
}

export type PaletteColor = string | number | [string, string, string] | [number, number, number] | [string, string, string, string] | [number, number, number, number];
export type PaletteEntry = [string | number, PaletteColor];
export type PaletteArray = PaletteEntry[];

const LINE_SEPARATOR_REGEX = /[ ,\t:]+/g;
const COLOR_SEPARATOR_REGEX = /[\-\/]/g;

function isLineComment(line: string): boolean {
  return line.startsWith('#');
}

function isGmt4Text(lines: string[]): boolean {
  return lines.some(line => {
    if (!isLineComment(line)) {
      if (line.split(LINE_SEPARATOR_REGEX).length >= 8) {
        return true;
      }
    }
    return false;
  });
}

function isGmt5Text(lines: string[]): boolean {
  return lines.some(line => {
    if (!isLineComment(line)) {
      if (line.match(/\d+\-\d+\-\d+/) || line.match(/\d+\/\d+\/\d+/)) {
        return true;
      }
    }
    return false;
  });
}

function getMode(lines: string[]): InterpolationMode | undefined {
  const modeLine = lines.find(line => isLineComment(line) && line.includes('COLOR_MODEL = '));
  if (modeLine) {
    const match = modeLine.match(/COLOR_MODEL = ([a-zA-Z]+)/);
    if (match) {
      return match[1].toLowerCase() as InterpolationMode;
    }
  }
  return undefined;
}

function splitColor(color: string): PaletteColor {
  const colorArray = color.split(COLOR_SEPARATOR_REGEX);
  return colorArray.length === 1 ? colorArray[0] : colorArray as PaletteColor;
}

function parsePaletteTextInternal(paletteText: string): { paletteArray: PaletteArray, mode?: InterpolationMode } {
  const lines = paletteText.split('\n')
    .map(line => line.trim());
  const isGmt4 = isGmt4Text(lines);
  const isGmt5 = isGmt5Text(lines);
  const mode = getMode(lines);

  const paletteLines = lines.filter(x => !!x && !x.startsWith('#'))
  const paletteArray: PaletteArray = [];
  for (let paletteLine of paletteLines) {
    const fields = paletteLine.split(LINE_SEPARATOR_REGEX);
    if (isGmt4) {
      if (fields.length === 8 || fields.length === 9) {
        paletteArray.push([fields[0], [fields[1], fields[2], fields[3]]]);
        paletteArray.push([fields[4], [fields[5], fields[6], fields[7]]]);
      } else if (fields.length === 4 || fields.length === 5) {
        paletteArray.push([fields[0], [fields[1], fields[2], fields[3]]]);
      } else {
        // ignore
      }
    } else if (isGmt5) {
      if (fields.length === 4 || fields.length === 5) {
        paletteArray.push([fields[0], splitColor(fields[1])]);
        paletteArray.push([fields[2], splitColor(fields[3])]);
      } else if (fields.length === 2 || fields.length === 3) {
        paletteArray.push([fields[0], splitColor(fields[1])]);
      } else {
        // ignore
      }
    } else {
      if (fields.length === 5) {
        paletteArray.push([fields[0], [fields[1], fields[2], fields[3], fields[4]]]);
      } else if (fields.length === 4) {
        paletteArray.push([fields[0], [fields[1], fields[2], fields[3]]]);
      } else if (fields.length === 2) {
        paletteArray.push([fields[0], fields[1]]);
      } else {
        // ignore
      }
    }
  }

  return { paletteArray, mode };
}



function parsePaletteArray(paletteArray: PaletteArray, { bounds = [0, 1], mode = DEFAULT_MODE }: ParseOptions & { mode?: InterpolationMode } = {}): Scale {
  const colors: (object | string)[] = [];
  const domain: number[] = [];
  let nodata;
  for (let [value, color] of paletteArray) {
    const parsedValue = parseValue(value, bounds);
    const parsedColor = parseColor(color, mode);

    if (parsedValue != null) {
      colors.push(parsedColor);
      domain.push(parsedValue);
    } else if (parsedValue === null) {
      nodata = parsedColor;
    } else {
      // ignore
    }
  }

  let palette = chroma.scale(colors as any).domain(domain).mode(mode);
  if (typeof nodata !== 'undefined') {
    palette = (palette as any).nodata(nodata);
  }
  return palette;
}

function parsePaletteText(paletteText: string, { bounds = [0, 1] }: ParseOptions = {}): Scale {
  const { paletteArray, mode } = parsePaletteTextInternal(paletteText);
  return parsePaletteArray(paletteArray, { bounds, mode });
}

export function parsePalette(palette: Palette, { bounds = [0, 1] }: ParseOptions = {}): Scale {
  if (typeof palette === 'string') {
    return parsePaletteText(palette, { bounds });
  } else if (Array.isArray(palette)) {
    return parsePaletteArray(palette, { bounds });
  } else {
    throw new Error('Invalid format');
  }
}
// export function parsePaletteWithStops(palette: Palette, { bounds = [0, 1] }: ParseOptions = {}): palette: Scale, domain: number[]} {
//   if (typeof palette === 'string') {
//     return parsePaletteText(palette, { bounds });
//   } else if (Array.isArray(palette)) {
//     return parsePaletteArray(palette, { bounds });
//   } else {
//     throw new Error('Invalid format');
//   }
// }