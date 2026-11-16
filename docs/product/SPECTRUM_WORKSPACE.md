# Spectrum Workspace

## Common interaction model

Every modality uses a deterministic chart canvas with pan, wheel/pinch zoom, reset, crosshair/cursor, range/point selection, peak markers, annotations, overlays, comparison, source/provenance, data table alternative, and export. Axes always show quantity, units, orientation, transformation, and scale.

The active selection is a typed peak/range/data-point reference that can link to assignments, atoms, modes, planes, structures, evidence, and AI explanation. Keyboard users can navigate the peak/data table and focus the equivalent plot range.

## Raw-preserving processing pipeline

```text
RAW DATASET (immutable)
   └─ derived branch v1
       ├─ baseline correction {algorithm, parameters}
       ├─ smoothing {algorithm, window/order}
       ├─ normalization {method/reference}
       └─ peak picking {algorithm, threshold}
```

Each step records input, algorithm/version, parameters, actor, timestamp, output hash, units, warnings, and reversibility. Preview is not committed data. Reordering incompatible steps is blocked/explained. Manual peak/assignment changes create a new analysis version. Raw is always one action away.

## Modality extensions

| Modality | Specific controls/semantics |
|---|---|
| FTIR | wavenumber orientation, transmittance/absorbance, baseline, smoothing, peak picking, calculated frequency scaling, mode mapping |
| NMR | nucleus/solvent/frequency/reference, chemical-shift axis direction, phase/baseline, integration, multiplets, assignments; raw FID processing later where feasible |
| HRMS | m/z, intensity, centroid/profile, isotope/adduct/charge annotations, formula candidates, mass error ppm; vendor conversion constraints explicit |
| XRD | 2θ/q/d axes, wavelength, background, peak/phase/plane mapping, calculated pattern overlay; refinement not implied |
| UV–Vis | wavelength/energy/wavenumber axes, absorbance/extinction, baseline, bands, calculated transitions where available |
| TG/DTG/DTA | temperature/time axis, mass/derivative/heat-flow channels, heating rate/atmosphere, onset/step/event analysis |
| DLS | size/intensity/volume/number distributions, acquisition model, fit quality, multimodal caution; not treated as ordinary spectral peaks |

Controls appear only when scientifically applicable. “Smoothing” or “normalization” is not a generic always-on button.

## Comparison

Overlays preserve each dataset's independent units/source. Deterministic transforms for alignment, normalization, scaling, or frequency correction are named and reversible. The view can show residual/difference metrics and a mapping table. AI may explain mismatches but cannot alter alignment or assignments invisibly.

## States and errors

Unsupported/invalid axes, missing metadata, failed parser, saturation, insufficient points, poor baseline, low-confidence peak picking, and conflicting assignments are explicit. A plot never fabricates interpolation outside source range. Large datasets may render decimated views while metrics/export operate on full data and disclose the display reduction.

See [spectrum wireframes](../wireframes/SPECTRUM_WIREFRAMES.md), [provenance UX](PROVENANCE_UX.md), and [ADR-019](../adr/ADR-019-raw-preserving-processing.md).
