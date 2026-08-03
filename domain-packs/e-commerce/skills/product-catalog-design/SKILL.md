---
name: "product-catalog-design"
description: "Product models, variants, attributes, categories, search, faceting"
tier: domain
domain: "e-commerce"
version: "1.0.0"
relevance_keywords:
  - catalog
  - product
  - variant
  - attribute
  - facet
  - search
---

# Product Catalog Design

## When to Activate
- When working on e-commerce projects that involve product data modeling, variant management, or catalog search
- When designing category hierarchies, attribute schemas, or faceted navigation

## Core Principles
### 1. Separate Product from Variant
Products and variants (SKUs) are distinct entities with different lifecycles. A product holds shared attributes (description, brand, category) while variants hold purchasable specifics (size, color, price, inventory). Conflating them creates data modeling problems at scale.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Storing variant-specific data (price, inventory) at the product level instead of the SKU/variant level
