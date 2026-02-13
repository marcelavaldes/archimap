# User Stories - ArchiMap

## Epic 1: Map Exploration

### US-1.1: View France Map
> As a user searching where to live in France, I want to see an interactive map of the country to visually explore different regions.

**Acceptance Criteria:**
- [ ] Map loads in less than 3 seconds
- [ ] Can zoom with scroll/pinch
- [ ] Can drag to pan the map
- [ ] Administrative boundaries are clearly visible

---

### US-1.2: Visualize Criterion on Map
> As a user, I want to see a colored map based on the criterion I'm interested in (e.g., cost of living) to quickly identify favorable zones.

**Acceptance Criteria:**
- [ ] Criteria selector visible (climate, cost, services, employment, quality of life)
- [ ] When selecting a criterion, map colors in chromatic scale
- [ ] Legend visible showing what each color means
- [ ] Smooth transition when changing criterion (< 500ms)

---

### US-1.3: View Information on Hover
> As a user, I want to see basic information about a zone when hovering over it to get quick data without clicking.

**Acceptance Criteria:**
- [ ] Tooltip appears on hover with: zone name, current criterion value, national ranking
- [ ] Tooltip disappears when cursor moves away
- [ ] Tooltip doesn't obstruct navigation

---

### US-1.4: Activate Multiple Layers
> As a user, I want to overlay multiple criteria on the map to find zones that meet multiple conditions.

**Acceptance Criteria:**
- [ ] Can toggle each criterion as a layer on/off
- [ ] Layers overlap visually (transparency)
- [ ] Can see up to 3 criteria simultaneously
- [ ] Indicator showing which layers are active

---

## Epic 2: Hierarchical Navigation

### US-2.1: Navigate from Region to Department to Commune
> As a user unfamiliar with French geography, I want to click on a region to see its departments, then on a department to see its communes.

**Acceptance Criteria:**
- [ ] Click on region → zoom to region + show departments
- [ ] Click on department → zoom to department + show communes
- [ ] Breadcrumb visible (France > Occitanie > Hérault > Montpellier)
- [ ] "Back" button to go up a level

---

### US-2.2: Search Specific Location
> As a user, I want to search for a commune by name to go directly to it without manual navigation.

**Acceptance Criteria:**
- [ ] Search field visible in the interface
- [ ] Autocomplete when typing (minimum 3 characters)
- [ ] When selecting result, map centers on that location
- [ ] Search works with accents (Montpellier = Montpéllier)

---

### US-2.3: Share Specific Location
> As a user, I want to copy a link that leads directly to a specific commune to share it with my partner.

**Acceptance Criteria:**
- [ ] URL reflects current location (e.g., /map/commune/34172)
- [ ] When opening link, map loads centered on that location
- [ ] Selected criteria are also saved in URL
- [ ] "Copy link" button easy to find

---

## Epic 3: Detailed Analysis

### US-3.1: View Complete Commune Profile
> As a user, I want to see all criteria of a commune in a detailed panel to make an informed decision.

**Acceptance Criteria:**
- [ ] Click on commune opens side panel
- [ ] Panel shows: name, population, department, region
- [ ] All criteria with numeric values and scores
- [ ] Radar chart comparing the 5 criteria
- [ ] National and departmental ranking

---

### US-3.2: Compare Communes Side by Side
> As a user, I want to compare 2-5 communes that interest me to see which best meets my needs.

**Acceptance Criteria:**
- [ ] Can mark communes as "favorites" / "to compare"
- [ ] Comparison view shows communes in columns
- [ ] Table with all criteria as rows
- [ ] Visual highlight of best value per criterion
- [ ] Can remove communes from comparison

---

## Epic 4: Consultant Features

### US-4.1: Create Client Profile
> As an architect-consultant, I want to save each client's preferences to generate personalized recommendations.

**Acceptance Criteria:**
- [ ] Form: name, email, maximum budget
- [ ] Sliders for each criterion weight (e.g., climate 30%, cost 40%...)
- [ ] Constraints: "near airport", "coast", etc.
- [ ] Profile saved in my workspace
- [ ] Client list in dashboard

---

### US-4.2: Generate PDF Report for Client
> As a consultant, I want to generate a professional PDF report comparing selected communes to present to my client.

**Acceptance Criteria:**
- [ ] Select client + communes to compare
- [ ] Field for personalized notes
- [ ] "Generate PDF" button
- [ ] PDF includes: branding, map, comparison table, recommendation
- [ ] PDF downloadable and saved in history

---

### US-4.3: Create Custom Criterion
> As a consultant specialized in wineries, I want to add a "proximity to vineyards" criterion for my specific clients.

**Acceptance Criteria:**
- [ ] Can create new criterion with name
- [ ] Define metrics that compose the criterion
- [ ] Enter data manually per commune (or import CSV)
- [ ] Criterion appears as additional option on map
- [ ] Only visible to my organization

---

### US-4.4: Manage My Organization
> As lead consultant, I want to invite collaborators to my organization so they can view and edit client profiles.

**Acceptance Criteria:**
- [ ] Can invite users by email
- [ ] Assign roles: admin, editor, viewer
- [ ] Client data is shared within organization
- [ ] Can remove users
