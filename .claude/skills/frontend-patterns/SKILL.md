---
name: "frontend-patterns"
description: "Frontend development — component patterns, state management, accessibility, responsive design"
tier: engineering
version: "1.0.0"
---

# Frontend Patterns

## When to Activate
- When building UI components or managing client-side state

## Core Principles
### 1. Components
Small, focused (< 200 lines). Separate presentation and logic. Composition over inheritance.

### 2. Accessibility (WCAG 2.1 AA)
Semantic HTML. ARIA labels. Keyboard navigation. Color contrast 4.5:1.

### 3. State
Local for component data. Shared only when needed. Server state with caching.

## Red Flags
- Divs instead of semantic elements
- Missing alt text
- Click handlers without keyboard equivalents
