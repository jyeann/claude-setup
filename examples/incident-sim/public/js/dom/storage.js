// The one place that touches localStorage. core/store.js wraps every call, so blocked or missing storage never throws.
import { createStore } from '../core/store.js';

export const store = createStore(() => window.localStorage);
