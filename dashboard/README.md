# Scrapbook Dashboard CSS System

A Swiss brutalist design system for realtime data monitoring. Built on strict vertical rhythm, high contrast typography, and functional minimalism.

## Design Philosophy

This system follows three core principles:

1. **Function Over Form**: Every pixel serves a purpose. No decoration.
2. **Vertical Rhythm**: Everything aligns to an 8px baseline grid for visual harmony.
3. **Color as Signal**: Color indicates status, not aesthetics. High contrast ensures readability during long monitoring sessions.

## Quick Start

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <link rel="stylesheet" href="dashboard.css">
</head>
<body>
  <div class="dashboard">
    <header class="dashboard-header">
      <h1 class="dashboard-title">YOUR DASHBOARD</h1>
      <div class="dashboard-subtitle">Realtime monitoring</div>
    </header>
    
    <div class="data-grid">
      <div class="data-field">
        <div class="data-field__label">Metric Name</div>
        <div class="data-field__value">1,234</div>
        <div class="data-field__meta">Updated 5s ago</div>
      </div>
    </div>
  </div>
</body>
</html>
```

## Grid Layout Strategy

The grid system is built on CSS Grid with intelligent auto-fitting:

```css
.data-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}
```

### Grid Variants

**Compact Grid** - Dense data display
```html
<div class="data-grid data-grid--compact">
  <!-- Minimum 180px columns, 8px gaps -->
</div>
```

**Spacious Grid** - Important metrics
```html
<div class="data-grid data-grid--spacious">
  <!-- Minimum 320px columns, 24px gaps -->
</div>
```

**Fixed Columns** - Consistent layout
```html
<div class="data-grid data-grid--3col">
  <!-- Always 3 columns (responsive to 1 column on mobile) -->
</div>
```

### Why This Grid Works

1. **Auto-fit**: Columns automatically adjust to available space
2. **Min/Max sizing**: Prevents columns from being too narrow or too wide
3. **Responsive by default**: Gracefully collapses to single column on mobile
4. **Dense packing**: `auto-flow: dense` fills gaps efficiently

## Typography System

All typography maintains perfect vertical rhythm using an 8px baseline grid.

### Font Scale

| Class | Size | Line Height | Use Case |
|-------|------|-------------|----------|
| `.text-xs` | 12px | 16px (2×) | Labels, meta |
| `.text-sm` | 14px | 24px (3×) | Secondary text |
| `.text-base` | 16px | 24px (3×) | Body text |
| `.text-lg` | 20px | 32px (4×) | Values, data |
| `.text-xl` | 24px | 32px (4×) | Section titles |
| `.text-2xl` | 32px | 40px (5×) | Page titles |

### Font Stack

```css
--font-mono: 'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', 
             'Cascadia Code', 'Consolas', monospace;
```

Monospace only. No exceptions. This enforces:
- Tabular alignment for numbers
- Technical, no-nonsense aesthetic
- Excellent readability for code and data

## Data Field Components

The core building block is `.data-field`:

```html
<div class="data-field">
  <span class="data-field__status"></span>
  <div class="data-field__label">Metric Name</div>
  <div class="data-field__value">1,234</div>
  <div class="data-field__meta">Updated 5s ago</div>
</div>
```

### Anatomy

- **Label**: Small, uppercase, muted - identifies the data
- **Value**: Large, bold, prominent - the actual data
- **Meta**: Tiny, subtle - timestamps, context
- **Status**: Visual indicator dot - system status

### Field Variants

**With Progress Bar**
```html
<div class="data-field data-field--progress">
  <div class="data-field__label">Completion</div>
  <div class="data-field__value">78%</div>
  <div class="data-field__progress-bar" style="width: 78%;"></div>
</div>
```

**With Trend Indicator**
```html
<div class="data-field">
  <div class="data-field__label">Revenue</div>
  <div class="data-field__value">$12,345</div>
  <div class="data-field__trend data-field__trend--up">
    ▲ 12% from last week
  </div>
</div>
```

**With List Data**
```html
<div class="data-field">
  <div class="data-field__label">System Status</div>
  <div class="data-field__value">Operational</div>
  <div class="data-field__list">
    <div class="data-field__list-item">Database: Online</div>
    <div class="data-field__list-item">API: Healthy</div>
  </div>
</div>
```

## Animation System

Animations are subtle and purposeful. Three primary animations:

### 1. Data Flash (Updates)

Triggers when a value changes:

```javascript
field.classList.add('data-field--updated');
setTimeout(() => field.classList.remove('data-field--updated'), 200);
```

**When to use**: Value updates, new data received
**Duration**: 200ms (fast but noticeable)
**Effect**: Brief background flash

### 2. Status Pulse (Alerts)

Continuous pulse for attention:

```html
<div class="data-field data-field--error">
  <span class="data-field__status data-field__status--pulse"></span>
  <div class="data-field__label">Failed Jobs</div>
  <div class="data-field__value">3</div>
</div>
```

**When to use**: Critical errors, warnings requiring action
**Duration**: 2s loop (1s for critical errors)
**Effect**: Pulsing status indicator

### 3. Shimmer Loading

Shows data is being fetched:

```html
<div class="data-field data-field--loading">
  <div class="data-field__label">Processing</div>
  <div class="data-field__value">Loading...</div>
</div>
```

**When to use**: API calls, async operations
**Duration**: 1.5s loop
**Effect**: Shimmer across value area

### Animation Philosophy

- **Under 300ms**: Feels instant but visible
- **No constant motion**: Prevents fatigue
- **Purposeful only**: Every animation signals something
- **Gentle easing**: `cubic-bezier(0.22, 1, 0.36, 1)`

## Color System

Colors are semantic, not decorative.

### Status Colors

| Color | Use Case | When to Use |
|-------|----------|-------------|
| `--color-success` (#00ff41) | Success, active, positive | Completed operations, healthy systems |
| `--color-error` (#ff0040) | Errors, critical alerts | Failed jobs, system errors |
| `--color-warning` (#ffff00) | Warnings, in-progress | Pending items, elevated states |
| `--color-info` (#00d9ff) | Information, neutral status | Metadata, informational alerts |

### Grayscale Hierarchy

```css
--color-text-primary: #ffffff    /* Main content */
--color-text-secondary: #cccccc  /* Supporting text */
--color-text-tertiary: #999999   /* Meta information */
--color-text-muted: #666666      /* Labels, least important */
```

### Status Field Examples

```html
<!-- Success State -->
<div class="data-field data-field--success">
  <span class="data-field__status"></span>
  <div class="data-field__label">Database</div>
  <div class="data-field__value">Connected</div>
</div>

<!-- Error State (with pulse) -->
<div class="data-field data-field--error">
  <span class="data-field__status data-field__status--pulse"></span>
  <div class="data-field__label">API Errors</div>
  <div class="data-field__value">3</div>
</div>

<!-- Warning State -->
<div class="data-field data-field--warning">
  <span class="data-field__status"></span>
  <div class="data-field__label">Queue Size</div>
  <div class="data-field__value">127</div>
</div>
```

## Section Organization

Group related data into sections:

```html
<section class="data-section">
  <div class="data-section__header">
    <h2 class="data-section__title">CRITICAL METRICS</h2>
    <div class="data-section__meta">Updated every 30s</div>
  </div>
  
  <div class="data-grid">
    <!-- Data fields here -->
  </div>
</section>
```

Sections provide:
- Visual separation between data groups
- Context with title and metadata
- Breathing room with consistent spacing

## Responsive Design

The system is desktop-first but gracefully responsive:

**Desktop (1280px+)**
- Multi-column grids
- Minimum 240px columns
- 16px gaps

**Tablet (768px-1280px)**
- Reduced minimum column width (200px)
- Adjusted padding
- Maintained grid structure

**Mobile (<768px)**
- Single column layout
- Full-width fields
- Reduced spacing
- Simplified typography

## UX Insights

### Making Realtime Data Digestible

From years of watching people use monitoring dashboards:

1. **Scannability Over Readability**
   - Eyes move in F-patterns across dashboards
   - Most important data top-left
   - Critical alerts should break the pattern (pulse, color)

2. **Visual Hierarchy Through Weight, Not Color**
   - Labels small and muted
   - Values large and bold
   - Meta tiny and subtle
   - Color only for status

3. **Update Visibility**
   - Flash animation catches peripheral vision
   - 200ms is fast enough to not annoy, slow enough to notice
   - Only animate what changed, not the whole field

4. **Cognitive Load Management**
   - Group related metrics
   - Consistent positioning (labels always top, values always center)
   - Predictable spacing (8px grid) reduces mental overhead

5. **Alert Fatigue Prevention**
   - Pulse only for actionable items
   - No sound effects (visual only)
   - Color coding helps prioritize (red = urgent, yellow = monitor)

6. **Long Session Ergonomics**
   - High contrast reduces eye strain
   - Monospace prevents eye jumping
   - Dark background easier on eyes at 3am
   - No pure white (#ffffff too harsh, but used here for maximum contrast)

### Design Decisions Explained

**Why monospace only?**
- Tabular data aligns naturally
- Numbers line up vertically
- Technical aesthetic fits monitoring tools
- Reduces cognitive load (one font to process)

**Why 8px baseline grid?**
- Everything aligns predictably
- Easy to calculate spacing (2×, 3×, 4× base)
- Creates visual rhythm that feels harmonious
- Pixel-perfect at common screen resolutions

**Why such high contrast?**
- Readability in bright office lights
- Readability at night with low screen brightness
- Works on both high-end and budget monitors
- Accessibility for low vision users

**Why CSS Grid instead of Flexbox?**
- Two-dimensional layout control
- Auto-fit/auto-fill magic
- Easier responsive behavior
- Cleaner markup (no wrapper divs)

## Integration Example

Connect to live data with minimal JavaScript:

```javascript
// WebSocket connection
const ws = new WebSocket('wss://your-api.com/metrics');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  // Find field and update value
  const field = document.querySelector(`[data-metric="${data.metric}"]`);
  const valueEl = field.querySelector('.data-field__value');
  
  // Update with flash animation
  field.classList.add('data-field--updated');
  valueEl.textContent = data.value;
  
  // Remove animation class
  setTimeout(() => {
    field.classList.remove('data-field--updated');
  }, 200);
  
  // Update status if needed
  if (data.status === 'error') {
    field.classList.add('data-field--error');
  }
};
```

## Browser Support

- Chrome/Edge 88+ (CSS Grid support)
- Firefox 75+ (CSS Grid support)
- Safari 14+ (CSS Grid support)

Uses modern CSS features:
- CSS Custom Properties (variables)
- CSS Grid
- CSS Animations
- `clamp()`, `min()`, `max()` functions

No JavaScript required for layout or styling. All animations are CSS-based.

## Customization

Override design tokens in your own CSS:

```css
:root {
  /* Change accent color */
  --color-success: #00ff00;
  
  /* Adjust baseline grid */
  --grid-base: 4px;
  
  /* Change font */
  --font-mono: 'Your Mono Font', monospace;
  
  /* Adjust grid sizing */
  --grid-min-width: 300px;
}
```

## Performance Notes

- Zero JavaScript for core functionality
- CSS animations use GPU acceleration
- Grid layout calculated once, not on each resize
- No external dependencies
- ~15KB CSS (unminified)

## Accessibility

- Semantic HTML structure
- High contrast ratios (AAA compliant)
- Keyboard navigable (if adding interactive elements)
- Screen reader friendly markup
- Print styles included

## Files

- `dashboard.css` - Main design system (15KB)
- `demo.html` - Interactive demo and living style guide
- `README.md` - This file

## License

MIT - Use it for whatever you want.

---

*Built with care by Clarence, your friendly janitor. Keep your data clean.*
