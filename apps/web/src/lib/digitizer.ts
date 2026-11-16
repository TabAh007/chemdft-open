export type AxisScale = "linear" | "log";

export type DigitizerPoint = {
  x: number;
  y: number;
};

export function formatDigitizedDlsPoint(index: number, diameterNm: number, qPercent: number): string {
  const diameter = Number(diameterNm.toPrecision(5));
  return `${index + 1} · ${diameter} nm · q ${qPercent.toFixed(2)}%`;
}

export type SourceRenderFrame = {
  page: number;
  pixelWidth: number;
  pixelHeight: number;
  cssWidth: number;
  cssHeight: number;
  scale: number;
  renderSha256: string;
  renderVersion: string;
};

export type XrdDigitizerCaptureMode =
  | "off"
  | "region-first"
  | "region-second"
  | "x-tick-a"
  | "x-tick-b"
  | "y-tick-a"
  | "y-tick-b"
  | "peaks"
  | "curve";

export type XrdDigitizerDraft = {
  sourceFrame: SourceRenderFrame | null;
  regionStart: DigitizerPoint | null;
  region: { x: number; y: number; width: number; height: number } | null;
  xPixelA: DigitizerPoint | null;
  xPixelB: DigitizerPoint | null;
  yPixelA: DigitizerPoint | null;
  yPixelB: DigitizerPoint | null;
  points: DigitizerPoint[];
  selectedPointIndex?: number | null;
};

export type AxisCalibration = {
  pixelA: DigitizerPoint;
  pixelB: DigitizerPoint;
  valueA: number;
  valueB: number;
  scale: AxisScale;
};

export type DigitizerCalibration = {
  xAxis: AxisCalibration;
  yAxis: AxisCalibration;
};

export function calibratedPoint(
  pixel: DigitizerPoint,
  calibration: DigitizerCalibration,
): DigitizerPoint {
  return {
    x: calibrateAxis(pixel.x, calibration.xAxis, "x"),
    y: calibrateAxis(pixel.y, calibration.yAxis, "y"),
  };
}

export function calibrateAxis(pixelValue: number, axis: AxisCalibration, dimension: "x" | "y"): number {
  const pixelA = axis.pixelA[dimension];
  const pixelB = axis.pixelB[dimension];
  if (!Number.isFinite(pixelA) || !Number.isFinite(pixelB) || pixelA === pixelB) {
    throw new Error("Digitizer calibration requires two distinct finite pixel points.");
  }
  const fraction = (pixelValue - pixelA) / (pixelB - pixelA);
  if (axis.scale === "linear") {
    return axis.valueA + fraction * (axis.valueB - axis.valueA);
  }
  if (axis.valueA <= 0 || axis.valueB <= 0) {
    throw new Error("Log-axis digitizer calibration requires positive reference values.");
  }
  const logA = Math.log10(axis.valueA);
  const logB = Math.log10(axis.valueB);
  return 10 ** (logA + fraction * (logB - logA));
}

export function normalizedAnchorToCssRect(
  anchor: { x?: number | null; y?: number | null; width?: number | null; height?: number | null },
  renderedWidth: number,
  renderedHeight: number,
): { left: number; top: number; width: number; height: number } {
  return {
    left: (anchor.x ?? 0) * renderedWidth,
    top: (anchor.y ?? 0) * renderedHeight,
    width: (anchor.width ?? 1) * renderedWidth,
    height: (anchor.height ?? 1) * renderedHeight,
  };
}
