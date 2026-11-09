import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { applyInitialTheme } from './app/core/theme/theme';

// Before the first render, so a dark page never flashes light.
applyInitialTheme();

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
