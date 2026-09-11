# OSCAR Design System

The design system is split into two layers:

- `themes/tokens.css` owns semantic colors, spacing, typography, radii, shadows, and runtime light/dark values.
- `premium.css` applies those tokens to shared interface patterns and legacy feature classes.

## Visual Direction

OSCAR uses a calm, dense desktop-control aesthetic. Surfaces are charcoal and satin rather than pure black. Blue is reserved for primary actions, focus, and selection. Green, amber, red, and indigo only communicate semantic state.

## Component Rules

- Prefer tables and compact lists for repeated operational data.
- Use cards for individual metrics, repeated entities, or framed tools, not for every section.
- Keep controls between 32 and 40 pixels high.
- Use Lucide icons only for actions, categories, or state.
- Technical identifiers use `--font-mono`; interface copy uses `--font-sans`.
- Use `--shell-*`, `--radius-*`, `--space-*`, and shared shadow tokens instead of local color values.
- Detail workflows belong in a modal, drawer, or bounded panel when navigation context should remain visible.

## Responsive Behavior

- Desktop keeps the sidebar persistent and supports its collapsed mode.
- Tablet turns dense grids into fewer columns.
- Mobile uses the navigation drawer, single-column metrics, internally scrollable tables, and full-screen modals.

All new shared visual decisions should be implemented here before being repeated in feature-specific styles.
