# Interactive Map Features

## Overview

The ArchiMap interactive map now includes comprehensive tooltip, detail panel, breadcrumb navigation, and click-based hierarchical navigation features.

## Components

### 1. Tooltip Component (`src/components/Map/Tooltip.tsx`)

**Purpose**: Shows contextual information when hovering over geographic features.

**Features**:
- Displays feature name, administrative level, and population (if available)
- Positioned near cursor with intelligent boundary detection
- Prevents overflow off-screen (adjusts position automatically)
- Styled with Tailwind using theme-aware background and borders

**Props**:
```typescript
interface TooltipProps {
  feature: GeoFeatureProperties | null;
  x: number;  // Mouse X position
  y: number;  // Mouse Y position
}
```

**Behavior**:
- Shows on hover over any region/département/commune
- Auto-adjusts position to stay within viewport
- Hides when mouse leaves feature

### 2. DetailPanel Component (`src/components/Map/DetailPanel.tsx`)

**Purpose**: Displays comprehensive information about a selected location.

**Features**:
- Slides in from right side with backdrop overlay
- Shows all available data fields for the location
- Close button and ESC key support
- Organized into sections: General Info, Demographics, Additional Data, Criteria (placeholder)
- Fully responsive with max-width constraint

**Props**:
```typescript
interface DetailPanelProps {
  feature: GeoFeatureProperties | null;
  onClose: () => void;
}
```

**Sections**:
1. **General Information**: Code, Level
2. **Demographics**: Population (if available)
3. **Additional Data**: All other feature properties
4. **Criteria**: Placeholder for future evaluation criteria

**Interactions**:
- Click backdrop or close button to dismiss
- Press ESC key to close
- Scrollable content for long lists

### 3. Breadcrumb Component (`src/components/Map/Breadcrumb.tsx`)

**Purpose**: Shows current navigation path through geographic hierarchy.

**Features**:
- Displays hierarchical path (France > Region > Département > Commune)
- Interactive navigation - click any level to return
- Home icon for France level
- Styled with separators and hover states

**Props**:
```typescript
interface BreadcrumbProps {
  items: BreadcrumbItem[];
  onNavigate: (index: number) => void;
}

interface BreadcrumbItem {
  level: AdminLevel | 'france';
  code?: string;
  nom: string;
}
```

**Example Path**:
```
France > Île-de-France > Paris > Paris 1er
```

### 4. Enhanced FranceMap Component

**New Features Added**:

1. **Click Navigation**:
   - Click region → zoom to region, prepare to load départements
   - Click département → zoom to département, prepare to load communes
   - Click commune → open DetailPanel with full information

2. **Hover Tooltips**:
   - Shows tooltip on any feature hover
   - Tracks cursor position
   - Updates in real-time

3. **Breadcrumb Navigation**:
   - Updates automatically on feature clicks
   - Click breadcrumb items to navigate back
   - Resets to France view from root

4. **State Management**:
   - Tooltip state (feature, position)
   - Selected feature state (for detail panel)
   - Navigation breadcrumb state
   - Current map level tracking

## User Interactions

### Hover Behavior
```
User hovers over feature
  ↓
Tooltip appears near cursor
  ↓
Tooltip shows: name, level, population, code
  ↓
Cursor becomes pointer
  ↓
User moves away → Tooltip disappears
```

### Click Navigation Flow
```
User clicks on region
  ↓
Map zooms to region bounds (animated)
  ↓
Breadcrumb updates: France > Region Name
  ↓
Ready to load départements for that region
  ↓
User clicks département
  ↓
Map zooms to département
  ↓
Breadcrumb updates: France > Region > Département
  ↓
Ready to load communes
  ↓
User clicks commune
  ↓
DetailPanel slides in from right
  ↓
Shows full commune information
```

### Breadcrumb Navigation
```
User at: France > Île-de-France > Paris
  ↓
Clicks "Île-de-France" in breadcrumb
  ↓
Map zooms back to region view
  ↓
Breadcrumb updates: France > Île-de-France
  ↓
Départements layer visible
```

## Implementation Details

### Zoom-to-Feature Logic

The `zoomToFeature` function calculates bounding boxes from GeoJSON geometries:

```typescript
const bounds = new LngLatBounds();

// Extract coordinates from Polygon or MultiPolygon
features.forEach(f => {
  if (f.geometry.type === 'Polygon') {
    f.geometry.coordinates[0].forEach((coord) => {
      bounds.extend([coord[0], coord[1]]);
    });
  } else if (f.geometry.type === 'MultiPolygon') {
    f.geometry.coordinates.forEach((polygon) => {
      polygon[0].forEach((coord) => {
        bounds.extend([coord[0], coord[1]]);
      });
    });
  }
});

map.fitBounds(bounds, { padding: 50, duration: 1000 });
```

### Feature Detection

The `getFeatureAtPoint` function queries rendered features at cursor position:

```typescript
const features = map.current.queryRenderedFeatures(e.point, {
  layers: ['regions-fill', 'departements-fill', 'communes-fill']
});
```

### Tooltip Positioning

Smart positioning prevents tooltips from going off-screen:

```typescript
// Adjust X position
if (adjustedX + rect.width > viewportWidth) {
  adjustedX = x - rect.width - offset;
}

// Adjust Y position
if (adjustedY + rect.height > viewportHeight) {
  adjustedY = y - rect.height - offset;
}
```

## Future Enhancements

### TODO Items

1. **Data Loading**:
   - Implement département loading when region is clicked
   - Implement commune loading when département is clicked
   - Add loading states for data fetch

2. **DetailPanel Enhancements**:
   - Integrate with criteria evaluation system
   - Show scores and rankings
   - Add comparison features
   - Display charts and visualizations

3. **Breadcrumb Features**:
   - Add keyboard navigation (arrow keys)
   - Show loading state during navigation
   - Add transition animations

4. **Tooltip Improvements**:
   - Add preview of criteria scores
   - Show rank indicator
   - Add custom styling per level

5. **Performance**:
   - Debounce mousemove events
   - Optimize re-renders
   - Cache feature queries

## Styling

All components use Tailwind CSS with theme-aware styling:

- `bg-background`: Theme background color
- `text-foreground`: Theme text color
- `border-border`: Theme border color
- `text-muted-foreground`: Muted text color
- `hover:bg-accent`: Hover state background

This ensures proper dark mode support and consistent theming.

## Testing Checklist

- [ ] Hover tooltip appears on all feature types
- [ ] Tooltip stays within viewport bounds
- [ ] Click on region zooms and updates breadcrumb
- [ ] Click on département zooms and updates breadcrumb
- [ ] Click on commune opens DetailPanel
- [ ] DetailPanel shows all feature data
- [ ] DetailPanel closes on backdrop click
- [ ] DetailPanel closes on ESC key
- [ ] DetailPanel closes on X button
- [ ] Breadcrumb navigation works correctly
- [ ] Returning to France resets view
- [ ] Dark mode styling works properly
- [ ] Mobile responsive behavior
