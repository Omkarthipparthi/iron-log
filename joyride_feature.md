# 🧭 Interactive Guided Tour & settings Burger Drawer Feature

An elite, fully-interactive onboarding tour and a mobile-decluttered burger settings drawer have been developed and are fully preserved on the dedicated feature branch **`feat/joyride-demo`**. 

This feature was kept on a separate branch to keep the `main` branch streamlined until you are ready to push it to production.

---

## ⚙️ Features Implemented on `feat/joyride-demo`

1. **Quick Settings Burger Drawer**:
   - Simplifies the app header by consolidating all settings into a slide-out drawer on the right side.
   - Contains unit preference toggles (KG/LBS), active lifter badges, database seeder/clear commands, account logouts, and a guided tour trigger button.
2. **Interactive Guided Onboarding Tour**:
   - Built using `react-joyride` (and resolved build issues under ESM/Rolldown).
   - Automatically launches for first-time signups to walk them through the logging view, At-Home templates, and bottom navigation.
   - Configured with global `disableBeacon: true` for clean, seamless tooltip progression (bypassing dark/barely-visible pulsing beacon circles).
3. **Firestore Tour State Persistence**:
   - Integrates the `tourCompleted` state variable directly into the Firestore database profile writes under `users/{userId}` to prevent the tour from re-running on browser refreshes or device changes.
4. **Auto-Tab Redirection**:
   - The settings drawer automatically switches tab focus back to the `Log` screen before triggering the tour, ensuring all tour target elements are fully rendered in the DOM.

---

## 🛠️ Git Commands to Manage the Feature

### 1. How to Switch & Run the Feature Branch Locally
To test the interactive guided tour and Settings Drawer in your local development environment:
```bash
# Switch to the feature branch
git checkout feat/joyride-demo

# Launch the local Vite dev server
npm run dev
```

### 2. How to Switch Back to Production (`main`)
To return to your clean, production-ready environment:
```bash
git checkout main
```

### 3. How to Merge the Feature into `main` (When Ready)
Once you are fully satisfied and ready to launch the Guided Tour and Settings Drawer live on your production site:
```bash
# Ensure you are on the main branch
git checkout main

# Merge the feature branch
git merge feat/joyride-demo

# Push the merged changes to trigger automatic GitHub Pages deployment
git push origin main
```
