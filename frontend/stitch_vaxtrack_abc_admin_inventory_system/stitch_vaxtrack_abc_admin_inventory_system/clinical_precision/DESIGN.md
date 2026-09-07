---
name: Clinical Precision
colors:
  surface: '#f9f9ff'
  surface-dim: '#cfdaf2'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f3ff'
  surface-container: '#e7eeff'
  surface-container-high: '#dee8ff'
  surface-container-highest: '#d8e3fb'
  on-surface: '#111c2d'
  on-surface-variant: '#434653'
  inverse-surface: '#263143'
  inverse-on-surface: '#ecf1ff'
  outline: '#737784'
  outline-variant: '#c3c6d5'
  surface-tint: '#1d59c1'
  primary: '#003c90'
  on-primary: '#ffffff'
  primary-container: '#0f52ba'
  on-primary-container: '#bcceff'
  inverse-primary: '#b0c6ff'
  secondary: '#505f76'
  on-secondary: '#ffffff'
  secondary-container: '#d0e1fb'
  on-secondary-container: '#54647a'
  tertiary: '#3d4143'
  on-tertiary: '#ffffff'
  tertiary-container: '#55585a'
  on-tertiary-container: '#ccced0'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d9e2ff'
  primary-fixed-dim: '#b0c6ff'
  on-primary-fixed: '#001945'
  on-primary-fixed-variant: '#00419c'
  secondary-fixed: '#d3e4fe'
  secondary-fixed-dim: '#b7c8e1'
  on-secondary-fixed: '#0b1c30'
  on-secondary-fixed-variant: '#38485d'
  tertiary-fixed: '#e0e3e5'
  tertiary-fixed-dim: '#c4c7c9'
  on-tertiary-fixed: '#191c1e'
  on-tertiary-fixed-variant: '#444749'
  background: '#f9f9ff'
  on-background: '#111c2d'
  surface-variant: '#d8e3fb'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  data-mono:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-margin: 24px
  gutter: 16px
  sidebar-width: 260px
  sidebar-collapsed: 72px
---

## Brand & Style
The design system is engineered for high-stakes healthcare environments where clarity and reliability are paramount. The brand personality is **clinical, systematic, and transparent**, prioritizing data integrity over decorative flair. 

The design style follows **Modern Minimalism with Functional Corporate** influences. It utilizes generous whitespace to reduce cognitive load during complex inventory audits, sharp typography for legibility, and a restricted color palette to ensure semantic signals (like low stock alerts) are immediately visible. The interface should feel like a high-end medical instrument: precise, dependable, and unobtrusive.

## Colors
The palette is anchored by **Medical Blue**, a deep, saturated primary hue that evokes trust and authority. 

- **Primary**: Used for key actions, active navigation states, and primary brand touchpoints.
- **Surface & Background**: Utilizes a range of cool grays (`#F8FAFC` to `#F1F5F9`) to differentiate content zones without the harshness of pure white.
- **Semantic Logic**: These colors are reserved strictly for status communication. Success indicates "In Stock," Warning indicates "Expiring Soon/Low Stock," and Danger indicates "Out of Stock/Expired."
- **Contrast**: Text follows strict WCAG AA guidelines, utilizing deep slate for primary body text to ensure maximum readability against light backgrounds.

## Typography
This design system employs **Inter** for its exceptional legibility and comprehensive glyph support. 

To support heavy data usage, the `data-mono` style utilizes **tabular figures** (fixed-width numbers), ensuring that columns of vaccine counts or batch numbers align perfectly for quick scanning. 

- **Headlines**: Use semibold weights with slight negative letter spacing to maintain a compact, professional feel.
- **Body Text**: Standardized at 14px for the majority of UI density, with 16px reserved for long-form reading or instructional modals.
- **Labels**: Used for table headers and small metadata, using uppercase and increased tracking to provide clear visual distinction from data.

## Layout & Spacing
The layout follows a **structured administrative grid** focused on maximizing the horizontal space for data tables.

- **Sidebar**: Fixed position on the left. Collapsible to icons-only to allow for expanded data views on smaller desktop screens.
- **Dashboard Grid**: A 12-column fluid system. On desktop, standard cards span 3 or 4 columns; primary data tables span the full 12.
- **Rhythm**: Uses a 4px base unit. Component internal padding is typically 12px or 16px, while section gaps are 24px or 32px to create a clear hierarchy of information blocks.
- **Mobile Adaptivity**: At the 768px breakpoint, the sidebar transitions to a hidden drawer, and 12-column layouts reflow to a single stack.

## Elevation & Depth
Depth is conveyed through **Tonal Layering and Low-Contrast Outlines** rather than heavy shadows, maintaining a clean, medical aesthetic.

- **Level 0 (Background)**: The base application background uses a very light cool gray (`#F8FAFC`).
- **Level 1 (Cards/Surface)**: White surfaces with a 1px solid border (`#E2E8F0`). No shadow is used for static elements.
- **Level 2 (Modals/Popovers)**: White surfaces with a 1px border and a soft, diffused ambient shadow (10% opacity, 12px blur) to indicate temporary interaction layers.
- **Interactive State**: On hover, cards or table rows may use a subtle tint change (`#F1F5F9`) rather than a lift effect to keep the interface feeling stable.

## Shapes
The shape language is **Soft (0.25rem)**, striking a balance between the precision of sharp corners and the modern friendliness of rounded UI.

- **Standard Elements**: Buttons, input fields, and checkboxes use a 4px (`0.25rem`) radius.
- **Containers**: Large cards and modals use an 8px (`0.5rem`) radius to soften the overall dashboard appearance.
- **Status Badges**: Use a fully rounded "pill" shape (100px) to distinguish them from interactive buttons.

## Components
- **Data Tables**: The core of the system. Use sticky headers, zebra-striping (subtle), and `data-mono` for numeric values. Status badges (e.g., "Available", "Low Stock") are placed in the final column or next to the item name.
- **Buttons**:
  - *Primary*: Solid Medical Blue with white text.
  - *Secondary*: Ghost style with a light gray border.
  - *Danger*: Outlined or solid red, reserved for irreversible actions like "Delete Batch."
- **Side Navigation**: Uses a vertical list with 16px icons. Active states use a thick 4px left-border accent in Primary Blue and a subtle background highlight.
- **Input Fields**: Labels are always top-aligned. Borders are 1px gray, turning Primary Blue on focus. Error states use a red border with a helper text message below.
- **Dashboard Cards**: Summarize key KPIs (e.g., "Total Doses", "Expiring 30 Days"). Use large `display-lg` numbers and a small trend indicator icon.
- **Modals**: Centered, max-width of 600px for CRUD operations, with a clear "Cancel" (ghost) and "Confirm" (solid) action pair in the footer.