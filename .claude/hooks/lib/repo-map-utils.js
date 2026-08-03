// repo-map-utils.js
// Utilities for reading and querying the generated repo map
//
// All public functions accept an optional `basePath` parameter that defaults
// to process.cwd().  This allows tests (and other callers) to point at an
// arbitrary directory without monkey-patching or chdir tricks.

const fs = require('fs');
const path = require('path');

/**
 * Resolve the full path to .planning/repo-map.md for a given base directory.
 */
function repoMapPath(basePath) {
  return path.join(basePath || process.cwd(), '.planning', 'repo-map.md');
}

// REMOVED: `REPO_MAP_PATH = repoMapPath(process.cwd())`. It froze the project root at the
// moment the module was FIRST required, so a consumer that loaded it before chdir — or a
// hook running against a --root other than the cwd — got a path into the wrong project.
// Nothing imported it, which is why it never bit; the file header's own promise ("without
// monkey-patching or chdir tricks") is only true of the function. Call repoMapPath(root)
// with an explicit root, as every internal caller already does.

/**
 * Check if repo map exists and is fresh (less than maxAge hours old).
 * @param {number}  [maxAgeHours=24]  Maximum acceptable age in hours.
 * @param {string}  [basePath]        Project root (defaults to cwd).
 * @returns {boolean}
 */
function isRepoMapFresh(maxAgeHours = 24, basePath) {
  const mapPath = repoMapPath(basePath);
  if (!fs.existsSync(mapPath)) return false;
  const stats = fs.statSync(mapPath);
  const ageMs = Date.now() - stats.mtimeMs;
  return ageMs < maxAgeHours * 60 * 60 * 1000;
}

/**
 * Parse the repo map markdown and return structured data.
 *
 * Returns an object keyed by section name.  Each section value is an array of
 * module objects: { path, exports, imports, patterns }.
 *
 * @param {string} [basePath] Project root (defaults to cwd).
 * @returns {Object|null}  Parsed sections or null if map does not exist.
 */
function parseRepoMap(basePath) {
  const mapPath = repoMapPath(basePath);
  if (!fs.existsSync(mapPath)) return null;

  const content = fs.readFileSync(mapPath, 'utf8');
  const sections = {};
  let currentSection = null;
  let currentModule = null;

  for (const line of content.split('\n')) {
    // New section (## heading)
    if (line.startsWith('## ')) {
      currentSection = line.replace('## ', '').trim();
      sections[currentSection] = [];
      currentModule = null;
      continue;
    }

    // New module within a section (### heading)
    if (line.startsWith('### ') && currentSection) {
      currentModule = line.replace('### ', '').trim();
      sections[currentSection].push({
        path: currentModule,
        exports: [],
        imports: [],
        patterns: [],
      });
      continue;
    }

    // Metadata lines inside a module block
    if (currentModule && currentSection && sections[currentSection].length > 0) {
      const mod = sections[currentSection][sections[currentSection].length - 1];

      const exportsMatch = line.match(/^\s*-\s*\*\*Exports:\*\*\s*(.+)/);
      const importsMatch = line.match(/^\s*-\s*\*\*Imports:\*\*\s*(.+)/);
      const patternsMatch = line.match(/^\s*-\s*\*\*Patterns:\*\*\s*\[(.+)\]/);

      if (exportsMatch) {
        mod.exports = exportsMatch[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (importsMatch) {
        mod.imports = importsMatch[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (patternsMatch) {
        mod.patterns = patternsMatch[1]
          .split('|')
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }
  }

  return sections;
}

/**
 * Get modules relevant to a specific agent based on their access boundaries.
 *
 * @param {string} agentType  One of 'backend', 'frontend', 'data',
 *                            'integration', 'infra', or 'all'.
 * @param {string} [basePath] Project root (defaults to cwd).
 * @returns {Array}           Relevant module objects from the repo map.
 */
function getModulesForAgent(agentType, basePath) {
  const map = parseRepoMap(basePath);
  if (!map) return [];

  const sectionMapping = {
    backend: ['Backend Modules'],
    frontend: ['Frontend Modules'],
    data: ['Data Layer'],
    integration: ['Integration Points', 'Backend Modules'],
    infra: [], // Infra reads from config files, not the map
    all: Object.keys(map),
  };

  const relevantSections = sectionMapping[agentType] || sectionMapping['all'];
  const modules = [];

  for (const section of relevantSections) {
    if (map[section] && Array.isArray(map[section])) {
      modules.push(...map[section]);
    }
  }

  return modules;
}

/**
 * Find which modules export a specific symbol.
 *
 * @param {string} symbolName  Full or partial export name to search for.
 * @param {string} [basePath]  Project root (defaults to cwd).
 * @returns {Array}            Matching { section, path, exports } objects.
 */
function findExport(symbolName, basePath) {
  const map = parseRepoMap(basePath);
  if (!map) return [];

  const results = [];
  for (const [section, modules] of Object.entries(map)) {
    if (!Array.isArray(modules)) continue;
    for (const mod of modules) {
      if (mod.exports && mod.exports.some((e) => e.includes(symbolName))) {
        results.push({ section, path: mod.path, exports: mod.exports });
      }
    }
  }
  return results;
}

/**
 * Get a compact summary suitable for agent context injection.
 * Returns a condensed string of the repo map (under 2000 tokens typically).
 *
 * @param {string} agentType  Agent type for filtering (see getModulesForAgent).
 * @param {string} [basePath] Project root (defaults to cwd).
 * @returns {string}          Markdown-formatted compact summary.
 */
function getCompactSummary(agentType, basePath) {
  const modules = getModulesForAgent(agentType, basePath);
  if (modules.length === 0) {
    return 'No repo map available. Run /atlas-repomap to generate.';
  }

  const lines = ['## Repo Map (compact)'];
  for (const mod of modules) {
    const exports =
      mod.exports.length > 5
        ? mod.exports.slice(0, 5).join(', ') + ` (+${mod.exports.length - 5} more)`
        : mod.exports.join(', ');
    const patterns = mod.patterns.join(', ');
    lines.push(`- **${mod.path}**: ${exports}${patterns ? ` [${patterns}]` : ''}`);
  }
  return lines.join('\n');
}

module.exports = {
  repoMapPath,
  isRepoMapFresh,
  parseRepoMap,
  getModulesForAgent,
  findExport,
  getCompactSummary,
};
